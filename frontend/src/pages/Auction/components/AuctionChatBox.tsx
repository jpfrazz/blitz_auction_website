import React, { useCallback, useEffect, useState } from 'react';
import { createDraftChat, fetchDraftChats } from '../../../shared/api/draftData';
import { ChatMessage } from '../../../types';
import './AuctionChatBox.scss';

interface AuctionChatBoxProps {
  draftId: string;
  isGuest: boolean;
}

const AuctionChatBox: React.FC<AuctionChatBoxProps> = ({ draftId, isGuest }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [isSending, setIsSending] = useState(false);

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
      await createDraftChat(draftId, trimmed);
      setNewMessage('');
      await loadChats();
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
    <div className="auction-chat-box">
      <div className="auction-chat-header">
        <div className="auction-chat-title">Chat</div>
      </div>
      <div className="auction-chat-body">
        {messages.length === 0 ? (
          <div className="auction-chat-empty">No messages yet.</div>
        ) : (
          messages.map(message => (
            <div className="auction-chat-message" key={message.chat_id}>
              <div className="auction-chat-message-header">
                <span className="auction-chat-user">{message.user_name}</span>
                <span className="auction-chat-time">{formatTime(message.created_at)}</span>
              </div>
              <div className="auction-chat-text">{message.message}</div>
            </div>
          ))
        )}
      </div>
      <form className="auction-chat-input-row" onSubmit={handleSend}>
        <input
          className="auction-chat-input"
          type="text"
          value={newMessage}
          onChange={event => setNewMessage(event.target.value)}
          placeholder={isGuest ? 'Guests can view chat only' : 'Type a message...'}
          disabled={isGuest || isSending}
        />
        <button
          className="auction-chat-send button"
          type="submit"
          disabled={isGuest || isSending || newMessage.trim().length === 0}
        >
          {isGuest ? 'Send' : isSending ? 'Sending...' : 'Send'}
        </button>
      </form>
    </div>
  );
};

export default AuctionChatBox;
