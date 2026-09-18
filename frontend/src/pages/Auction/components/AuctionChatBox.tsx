import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createDraftChat, fetchDraftChats } from '../../../shared/api/draftData';
import { ChatMessage } from '../../../types';
import './AuctionChatBox.scss';

interface AuctionChatBoxProps {
  draftId: string;
  isGuest: boolean;
  isLoggedIn: boolean;
  messages: ChatMessage[];
  onMessagesChange: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  wsConnected: boolean;
}

const REALTIME_POLL_INTERVAL_MS = 30000;

const AuctionChatBox: React.FC<AuctionChatBoxProps> = ({
  draftId,
  isGuest,
  isLoggedIn,
  messages,
  onMessagesChange,
  wsConnected,
}) => {
  const [newMessage, setNewMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [chatError, setChatError] = useState<string | null>(null);
  const chatBodyRef = useRef<HTMLDivElement | null>(null);
  const isNearBottomRef = useRef(true);
  const lastChatIdRef = useRef<number | null>(null);

  const isNearBottom = (element: HTMLDivElement) => {
    const threshold = 40;
    const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    return distanceFromBottom <= threshold;
  };

  const appendMessages = useCallback(
    (incoming: ChatMessage[]) => {
      if (incoming.length === 0) return;
      onMessagesChange((prev) => {
        const existingIds = new Set(prev.map((m) => m.chat_id));
        const fresh = incoming.filter((m) => !existingIds.has(m.chat_id));
        if (fresh.length === 0) return prev;
        return [...prev, ...fresh];
      });
    },
    [onMessagesChange],
  );

  const loadFullHistory = useCallback(async () => {
    try {
      const data = await fetchDraftChats(draftId);
      // Merge rather than replace: a NewMessage can arrive over the WebSocket
      // while this fetch is in flight, and replacing would drop it from view if
      // the DB snapshot predates it. Merging by chat_id can only add messages.
      onMessagesChange((prev) => {
        if (data.length === 0) return prev;
        const byId = new Map(prev.map((m) => [m.chat_id, m]));
        for (const m of data) {
          byId.set(m.chat_id, m);
        }
        return Array.from(byId.values()).sort((a, b) =>
          a.created_at.localeCompare(b.created_at),
        );
      });
    } catch (error) {
      console.error('Failed to fetch chats:', error);
    }
  }, [draftId, onMessagesChange]);

  const loadNewMessages = useCallback(async () => {
    if (lastChatIdRef.current === null) {
      await loadFullHistory();
      return;
    }
    try {
      const data = await fetchDraftChats(draftId, lastChatIdRef.current);
      appendMessages(data);
    } catch (error) {
      console.error('Failed to fetch chats:', error);
    }
  }, [draftId, loadFullHistory, appendMessages]);

  // Track the most recent chat id so incremental fetches only pull new messages.
  useEffect(() => {
    if (messages.length > 0) {
      lastChatIdRef.current = messages[messages.length - 1].chat_id;
    }
  }, [messages]);

  // Load full history once on mount. The page connects to the draft WebSocket,
  // so later messages are delivered via NewMessage events instead of polling.
  useEffect(() => {
    loadFullHistory();
  }, [loadFullHistory]);

  // If the WebSocket ever drops, fall back to a slow poll while the chat is
  // visible so messages still arrive. This polls incrementally, only returning
  // messages we have not seen yet.
  useEffect(() => {
    if (isCollapsed || wsConnected) {
      return;
    }
    const interval = setInterval(loadNewMessages, REALTIME_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [isCollapsed, wsConnected, loadNewMessages]);

  // When the WebSocket reconnects, refetch the full history to catch anything
  // missed while it was down.
  const wasConnectedRef = useRef(wsConnected);
  useEffect(() => {
    const wasConnected = wasConnectedRef.current;
    wasConnectedRef.current = wsConnected;
    if (wsConnected && !wasConnected) {
      loadFullHistory();
    }
  }, [wsConnected, loadFullHistory]);

  useEffect(() => {
    if (isCollapsed || !chatBodyRef.current) {
      return;
    }

    if (isNearBottomRef.current) {
      chatBodyRef.current.scrollTop = chatBodyRef.current.scrollHeight;
    }
  }, [messages, isCollapsed]);

  useEffect(() => {
    if (isCollapsed || !chatBodyRef.current) {
      return;
    }

    chatBodyRef.current.scrollTop = chatBodyRef.current.scrollHeight;
    isNearBottomRef.current = true;
  }, [isCollapsed]);

  const handleChatScroll = () => {
    if (!chatBodyRef.current) {
      return;
    }

    isNearBottomRef.current = isNearBottom(chatBodyRef.current);
  };

  const handleSend = async (event: React.FormEvent) => {
    event.preventDefault();
    setChatError(null);
    if (isGuest) {
      return;
    }

    const trimmed = newMessage.trim();
    if (!trimmed) {
      return;
    }

    setIsSending(true);
    setNewMessage('');
    try {
      const response = await createDraftChat(draftId, trimmed);
      if (response) {
        appendMessages([response]);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to send chat';
      setChatError(message);
    } finally {
      setIsSending(false);
    }
  };

  const formatTime = (iso: string) => {
    const date = new Date(iso);
    return Number.isNaN(date.getTime())
      ? ''
      : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className={`auction-chat-box ${isCollapsed ? 'collapsed' : ''}`}>
      <div className="auction-chat-header">
        <div className="auction-chat-title">Chat</div>
        <button
          type="button"
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="auction-chat-collapse-btn"
        >
          {isCollapsed ? '+' : '-'}
        </button>
      </div>
      {!isCollapsed && (
        <>
          <div className="auction-chat-body" ref={chatBodyRef} onScroll={handleChatScroll}>
            {messages.length === 0 ? (
              <div className="auction-chat-empty">No messages yet.</div>
            ) : (
              messages.map((message, index) => {
                const prevMessage = messages[index - 1];
                const showHeader = !prevMessage || prevMessage.user_name !== message.user_name;
                return (
                  <div className={`auction-chat-message${!showHeader ? ' chained' : ''}`} key={message.chat_id}>
                    {showHeader && (
                      <div className="auction-chat-message-header">
                        <span className="auction-chat-user">
                          <a
                            href={`/Stats/PlayerProfiles/${encodeURIComponent(message.user_name)}?userId=${encodeURIComponent(message.user_id)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {message.user_name}
                          </a>
                        </span>
                        <span className="auction-chat-time">{formatTime(message.created_at)}</span>
                      </div>
                    )}
                    <div className="auction-chat-text">{message.message}</div>
                  </div>
                );
              })
            )}
          </div>
          {chatError && <div className="auction-chat-error" style={{ color: '#ff4d4d', fontSize: '0.8rem', padding: '4px 8px' }}>{chatError}</div>}
          <form className="auction-chat-input-row" onSubmit={handleSend}>
            <input
              className="auction-chat-input"
              type="text"
              value={newMessage}
              onChange={event => setNewMessage(event.target.value)}
              placeholder={isGuest ? 'Log in with Discord to chat!' : 'Type a message...'}
              disabled={isGuest || !isLoggedIn}
            />
            <button
              className="auction-chat-send button"
              type="submit"
              disabled={isGuest || isSending || newMessage.trim().length === 0}
            >
              {isGuest ? 'Send' : isSending ? 'Sending...' : 'Send'}
            </button>
          </form>
        </>
      )}
    </div>
  );
};

export default AuctionChatBox;