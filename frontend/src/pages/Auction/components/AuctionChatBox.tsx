import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createDraftChat, fetchDraftChats } from '../../../shared/api/draftData';
import { ChatMessage } from '../../../types';
import './AuctionChatBox.scss';

interface AuctionChatBoxProps {
  draftId: string;
  isGuest: boolean;
  isLoggedIn: boolean;
}

const AuctionChatBox: React.FC<AuctionChatBoxProps> = ({ draftId, isGuest, isLoggedIn }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(true);
  const chatBodyRef = useRef<HTMLDivElement | null>(null);
  const isNearBottomRef = useRef(true);

  const isNearBottom = (element: HTMLDivElement) => {
    const threshold = 40;
    const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    return distanceFromBottom <= threshold;
  };

  const loadChats = useCallback(async () => {
    try {
      const data = await fetchDraftChats(draftId);
      setMessages(data);
    } catch (error) {
      console.error('Failed to fetch chats:', error);
    }
  }, [draftId]);

  useEffect(() => {
    loadChats();
    const interval = setInterval(loadChats, 1000);
    return () => clearInterval(interval);
  }, [loadChats]);

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
    if (isGuest) {
      return;
    }

    const trimmed = newMessage.trim();
    if (!trimmed) {
      return;
    }

    setIsSending(true);
    try {
      const response = await createDraftChat(draftId, trimmed);
      setNewMessage('');
      if (response) {
        setMessages((prev) => [...prev, response]);
      }
    } catch (error) {
      console.error('Failed to send chat:', error);
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
                        <span className="auction-chat-user">{message.user_name}</span>
                        <span className="auction-chat-time">{formatTime(message.created_at)}</span>
                      </div>
                    )}
                    <div className="auction-chat-text">{message.message}</div>
                  </div>
                );
              })
            )}
          </div>
          <form className="auction-chat-input-row" onSubmit={handleSend}>
            <input
              className="auction-chat-input"
              type="text"
              value={newMessage}
              onChange={event => setNewMessage(event.target.value)}
              placeholder={isGuest ? 'Log in with Discord to chat!' : 'Type a message...'}
              disabled={isGuest || isSending || !isLoggedIn}
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
