import React, { useEffect, useState } from 'react';
import './Header.scss';
import { Link, useLocation } from 'react-router-dom';
import { fetchCurrentUser, changeGuestName } from '../api/draftData';
import { UserRole } from '../../types';

const navButtons = [
  { label: "Leaderboard", link: "/Leaderboard" },
  { label: "Stats", link: "/Stats" },
  { label: "FAQ", link: "/FAQ" },
];

function Header() {
  const location = useLocation();
  const isAuctionPage = location.pathname === '/Auction';
  const linkTarget = isAuctionPage ? '_blank' : undefined;
  const linkRel = isAuctionPage ? 'noopener noreferrer' : undefined;

  const AUCTION_ALERT_SOUND_MUTED_KEY = 'auction_alert_sound_muted';
  const AUCTION_ALERT_SOUND_MUTED_EVENT = 'auction-alert-muted-changed';
  const HEADER_PINNED_KEY = 'header_pinned';

  const scrollToTop = () => {
    window.scrollTo(0, 0);
  };

  type UserState =
    | {
      is_guest: boolean;
      user_id: string | null;
      username: string | null;
      avatar?: string;
      roles?: UserRole[];
    };
  const [user, setUser] = useState<UserState | null>(null);
  useEffect(() => {
    fetchCurrentUser().then(user => {
      if(user.user_id && user.username) {
        setUser(user);
      } else {
        setUser(null);
      }
    }).catch(() => setUser(null));
  }, []);

  const [showNameModal, setShowNameModal] = useState(false);
  const [newGuestName, setNewGuestName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [changingName, setChangingName] = useState(false);
  const [isAuctionSoundMuted, setIsAuctionSoundMuted] = useState<boolean>(() => {
    if (typeof window === 'undefined') {
      return true;
    }
    return localStorage.getItem(AUCTION_ALERT_SOUND_MUTED_KEY) !== 'false';
  });
  const [isHeaderPinned, setIsHeaderPinned] = useState<boolean>(() => {
    if (typeof window === 'undefined') {
      return true;
    }
    return localStorage.getItem(HEADER_PINNED_KEY) !== 'false';
  });

  const toggleAuctionSoundMuted = () => {
    const nextMuted = !isAuctionSoundMuted;
    setIsAuctionSoundMuted(nextMuted);
    localStorage.setItem(AUCTION_ALERT_SOUND_MUTED_KEY, String(nextMuted));
    window.dispatchEvent(new CustomEvent(AUCTION_ALERT_SOUND_MUTED_EVENT, { detail: nextMuted }));
  };
  const toggleHeaderPinned = () => {
    const nextPinned = !isHeaderPinned;
    setIsHeaderPinned(nextPinned);
    localStorage.setItem(HEADER_PINNED_KEY, String(nextPinned));
  };

  const handleChangeName = async () => {
    setNameError(null);
    setChangingName(true);
    try {
      const namePart = newGuestName.replace(/^guest:/, '').trim();
      if (!namePart) throw new Error('Name cannot be empty');
      const updated = await changeGuestName(namePart);
      setUser(prev => prev ? { ...prev, username: updated } : prev);
      setShowNameModal(false);
      setNewGuestName('');
    } catch (e: any) {
      setNameError(e.message || 'Failed to change name');
    } finally {
      setChangingName(false);
    }
  };

  return (
    <header className={`header${isAuctionPage && isHeaderPinned ? ' header-pinned' : ''}`}>
      <div className="headerInner">
        <Link to="/" className="logoLink" onClick={scrollToTop} target={linkTarget} rel={linkRel}>
          <img
            src="/blitzlogo.png"
            alt="Emerald Blitz Logo"
            className="logoImg"
          />
        </Link>
        <nav className="nav">
          <div className="navDropdown">
            <button className="navButton navDropdownTrigger" type="button">
              Auctions
            </button>
            <div className="navDropdownMenu">
              <Link to="/AuctionSetup" className="navButton navDropdownItem" onClick={scrollToTop} target={linkTarget} rel={linkRel}>
                Auction Setup
              </Link>
              <Link to="/LobbyViewer" className="navButton navDropdownItem" onClick={scrollToTop} target={linkTarget} rel={linkRel}>
                Lobby Viewer
              </Link>
            </div>
          </div>
          <div className="navDropdown">
            <button className="navButton navDropdownTrigger" type="button">
              Documentation
            </button>
            <div className="navDropdownMenu">
              <Link to="/Info" className="navButton navDropdownItem" onClick={scrollToTop} target={linkTarget} rel={linkRel}>
                Blitz Info
              </Link>
              <Link to="/BossBattles" className="navButton navDropdownItem" onClick={scrollToTop} target={linkTarget} rel={linkRel}>
                Boss Battles
              </Link>
              <Link to="/PatchNotes" className="navButton navDropdownItem" onClick={scrollToTop} target={linkTarget} rel={linkRel}>
                Patch Notes
              </Link>
            </div>
          </div>
          <div className="navDropdown">
            <button className="navButton navDropdownTrigger" type="button">
              Pokémon
            </button>
            <div className="navDropdownMenu">
              <Link to="/Pokedex" className="navButton navDropdownItem" onClick={scrollToTop} target={linkTarget} rel={linkRel}>
                Pokédex
              </Link>
              <Link to="/TeamPlanner" className="navButton navDropdownItem" onClick={scrollToTop} target={linkTarget} rel={linkRel}>
                Team Planner
              </Link>
            </div>
          </div>
          {navButtons.map(btn => (
            <Link
              key={btn.label}
              to={btn.link}
              className="navButton"
              onClick={scrollToTop}
              target={linkTarget}
              rel={linkRel}
            >
              {btn.label}
            </Link>
          ))}
          {user && (user.roles ?? []).some((role) => role.role_name === 'Referee') && (
            <Link
              to="/Admin"
              className="navButton"
              onClick={scrollToTop}
              target={linkTarget}
              rel={linkRel}
            >
              Admin
            </Link>
          )}
          {!user && (
            <a href="/api/login" className="navButton" target={linkTarget} rel={linkRel}>Login</a>
          )}
          {user && !user.is_guest && (
            <div className="userDropdown">
              <button className="userDropdownTrigger" type="button">
                <img
                  src={`https://cdn.discordapp.com/avatars/${user.user_id}/${user.avatar}.png`}
                  alt="avatar"
                  className="userAvatar"
                />
                <h1>{user.username}</h1>
              </button>
              <div className="userDropdownMenu navDropdownMenu">
                <button className="navButton userDropdownItem" onClick={() => window.location.href = '/api/logout'}>
                  Logout
                </button>
              </div>
            </div>
          )}
          {user && user.is_guest && (
            <div className="userDropdown">
              <button className="userDropdownTrigger" type="button">
                <h1>{user.username}</h1>
              </button>
              <div className="userDropdownMenu navDropdownMenu">
                <button className="navButton userDropdownItem" onClick={() => setShowNameModal(true)}>
                  Change Name
                </button>
                <button className="navButton userDropdownItem" onClick={() => window.location.href = '/api/logout'}>
                  Logout
                </button>
              </div>
            </div>
          )}
          {isAuctionPage && (
            <div style={{ display: 'flex', gap: '3px' }}>
              <button
                type="button"
                className="headerSoundToggle"
                onClick={toggleAuctionSoundMuted}
                title={isAuctionSoundMuted ? 'Unmute auction sound' : 'Mute auction sound'}
                aria-label={isAuctionSoundMuted ? 'Unmute auction sound' : 'Mute auction sound'}
              >
                {isAuctionSoundMuted ? '🔇' : '🔊'}
              </button>
              <button
                type="button"
                className="headerSoundToggle"
                onClick={toggleHeaderPinned}
                title={isHeaderPinned ? 'Unpin header' : 'Pin header'}
                aria-label={isHeaderPinned ? 'Unpin header' : 'Pin header'}
              >
                {isHeaderPinned ? '📌' : '📍'}
              </button>
            </div>
          )}
        </nav>
      </div>
      {showNameModal && (
        <div className="guest-name-modal-overlay">
          <div className="guest-name-modal">
            <h3>Change Guest Name</h3>
            <div className="guest-name-modal-row">
              <span className="guest-name-modal-prefix">guest:</span>
              <input
                type="text"
                value={newGuestName}
                onChange={e => setNewGuestName(e.target.value.replace(/^guest:/, ''))}
                maxLength={32}
                placeholder="Enter new name"
                autoFocus
                className="guest-name-modal-input"
              />
            </div>
            {nameError && <div className="guest-name-modal-error">{nameError}</div>}
            <div className="guest-name-modal-actions">
              <button className="button" onClick={() => setShowNameModal(false)} disabled={changingName}>Cancel</button>
              <button className="button" onClick={handleChangeName} disabled={changingName || !newGuestName.trim()}>
                {changingName ? 'Changing...' : 'Change Name'}
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}

export default Header;
