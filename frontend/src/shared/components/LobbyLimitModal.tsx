import React from 'react';
import { Link } from 'react-router-dom';
import { MAX_HOSTED_LOBBIES } from '../api/draft';
import './LobbyLimitModal.scss';

interface LobbyLimitModalProps {
  onClose: () => void;
}

const LobbyLimitModal: React.FC<LobbyLimitModalProps> = ({ onClose }) => (
  <div className="lobby-limit-modal-overlay" onClick={onClose}>
    <div className="lobby-limit-modal" onClick={e => e.stopPropagation()}>
      <div className="lobby-limit-modal-header">
        <span>You're clogging the Lobby Viewer!</span>
        <button className="lobby-limit-modal-close" onClick={onClose} aria-label="Close">
          &times;
        </button>
      </div>
      <div className="lobby-limit-modal-body">
        <p>
          You already have {MAX_HOSTED_LOBBIES} open lobbies, which is the maximum.
          Delete at least one of your existing lobbies before creating a new one.
        </p>
        <p className="lobby-limit-modal-hint">
          Head to the Lobby Viewer, find one of your lobbies, and hit the trash icon to delete it.
        </p>
        <div className="lobby-limit-modal-actions">
          <Link className="navButton lobby-limit-modal-link" to="/Lobby">
            Go to Lobby Viewer
          </Link>
          <button className="navButton lobby-limit-modal-link" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  </div>
);

export default LobbyLimitModal;