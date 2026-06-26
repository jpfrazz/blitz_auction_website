import React, { useEffect, useState, useRef } from 'react';
import './Header.scss';
import { Link, useLocation } from 'react-router-dom';
import { fetchCurrentUser, changeGuestName } from '../api/draftData';
import { UserRole } from '../../types';
import SettingsModal from './SettingsModal';

const navButtons = [
  { label: "Leaderboard", link: "/Leaderboard" },
  { label: "Stats", link: "/Stats" },
  { label: "FAQ", link: "/FAQ" },
];

function Header() {
  const location = useLocation();
  const isAuctionPage = location.pathname === '/Auction';
  const isEmulatorPage = location.pathname.startsWith('/Emulator');
  const linkTarget = (isAuctionPage || isEmulatorPage) ? '_blank' : undefined;
  const linkRel = (isAuctionPage || isEmulatorPage) ? 'noopener noreferrer' : undefined;

  const AUCTION_ALERT_SOUND_MUTED_KEY = 'auction_alert_sound_muted';
  const AUCTION_ALERT_SOUND_MUTED_EVENT = 'auction-alert-muted-changed';
  const HEADER_PINNED_KEY = 'header_pinned';

  const scrollToTop = () => {
    window.scrollTo(0, 0);
  };

  useEffect(() => {
    const savedColor = localStorage.getItem('eb-primary-color') || '#7CB946';
    document.documentElement.style.setProperty('--eb-primary', savedColor);
  }, []);

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
  const [showNotes, setShowNotes] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [notes, setNotes] = useState('');
  const [fontSize, setFontSize] = useState(16);
  const editorRef = useRef<HTMLDivElement>(null);

  const [modalPos, setModalPos] = useState({ x: 0, y: 0 });
  const [modalSize, setModalSize] = useState({ width: 560, height: 640 });
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

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
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  useEffect(() => {
    if (user?.user_id) {
      const savedNotes = localStorage.getItem(`user_notes_${user.user_id}`);
      setNotes(savedNotes || '');

      const savedFontSize = localStorage.getItem(`user_notes_font_size_${user.user_id}`);
      if (savedFontSize) {
        setFontSize(parseInt(savedFontSize, 10));
      }

      const savedPos = localStorage.getItem(`user_notes_pos_${user.user_id}`);
      if (savedPos) {
        try {
          setModalPos(JSON.parse(savedPos));
        } catch (e) {
          console.error("Error loading notes position:", e);
        }
      }

      const savedSize = localStorage.getItem(`user_notes_size_${user.user_id}`);
      if (savedSize) {
        try {
          setModalSize(JSON.parse(savedSize));
        } catch (e) {
          console.error("Error loading notes size:", e);
        }
      }
    }
  }, [user?.user_id]);

  useEffect(() => {
    if (user?.user_id && (modalPos.x !== 0 || modalPos.y !== 0)) {
      localStorage.setItem(`user_notes_pos_${user.user_id}`, JSON.stringify(modalPos));
    }
  }, [modalPos, user?.user_id]);

  useEffect(() => {
    if (user?.user_id) {
      localStorage.setItem(`user_notes_size_${user.user_id}`, JSON.stringify(modalSize));
    }
  }, [modalSize, user?.user_id]);

  useEffect(() => {
    if (user?.user_id) {
      localStorage.setItem(`user_notes_font_size_${user.user_id}`, fontSize.toString());
    }
  }, [fontSize, user?.user_id]);

  useEffect(() => {
    if (user?.user_id) {
      const timer = setTimeout(() => {
        localStorage.setItem(`user_notes_${user.user_id}`, notes);
      }, 500); // Wait for 500ms of inactivity before saving

      return () => clearTimeout(timer);
    }
  }, [notes, user?.user_id]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'n') {
        // Only trigger if user is logged in via Discord (not a guest)
        if (!user || user.is_guest) return;
        
        // Prevent opening if the user is currently typing in a form field or chat
        const activeElement = document.activeElement;
        const isTyping =
          activeElement instanceof HTMLInputElement ||
          activeElement instanceof HTMLTextAreaElement ||
          (activeElement as HTMLElement)?.isContentEditable;

        if (!isTyping) {
          setShowNotes(prev => !prev);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [user]);

  useEffect(() => {
    if (showNotes && modalPos.x === 0 && modalPos.y === 0) {
      setModalPos({
        x: (window.innerWidth - modalSize.width) / 2,
        y: (window.innerHeight - modalSize.height) / 2,
      });
    }
  }, [showNotes, modalSize.width, modalSize.height, modalPos.x, modalPos.y]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        setModalPos({
          x: e.clientX - dragOffset.x,
          y: e.clientY - dragOffset.y
        });
      }
      if (isResizing) {
        setModalSize({
          width: Math.max(320, e.clientX - modalPos.x),
          height: Math.max(320, e.clientY - modalPos.y)
        });
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      setIsResizing(false);
    };

    if (isDragging || isResizing) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, isResizing, dragOffset, modalPos]);

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

  const toggleMobileMenu = () => {
    setIsMobileMenuOpen(prev => !prev);
  };

  // Close mobile menu when a link is clicked
  const handleNavLinkClick = () => {
    scrollToTop();
    setIsMobileMenuOpen(false);
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

  const handleNotesChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setNotes(value);
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
        <button 
          className={`mobileMenuToggle ${isMobileMenuOpen ? 'open' : ''}`} 
          onClick={toggleMobileMenu} 
          aria-label="Toggle navigation menu"
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          style={{
            backgroundColor: 'transparent',
            filter: isHovered ? 'brightness(1.2)' : 'none',
            transition: 'filter 0.2s ease'
          }}
        >
          <span></span>
          <span></span>
          <span></span>
        </button>
        <nav className={`nav ${isMobileMenuOpen ? 'mobileOpen' : ''}`}>
          <Link to="/" className="navButton mobile-only" onClick={handleNavLinkClick}>
            Home
          </Link>
          <div className="navDropdown">
            <button className="navButton navDropdownTrigger" type="button">
              Auctions
            </button>
            <div className="navDropdownMenu">
              <Link to="/AuctionSetup" className="navButton navDropdownItem" onClick={handleNavLinkClick} target={linkTarget} rel={linkRel}>
                Auction Setup
              </Link>
              <Link to="/LobbyViewer" className="navButton navDropdownItem" onClick={handleNavLinkClick} target={linkTarget} rel={linkRel}>
                Lobby Viewer
              </Link>
            </div>
          </div>
          <div className="navDropdown">
            <button className="navButton navDropdownTrigger" type="button">
              Documentation
            </button>
            <div className="navDropdownMenu">
              <Link to="/Info" className="navButton navDropdownItem" onClick={handleNavLinkClick} target={linkTarget} rel={linkRel}>
                Blitz Info
              </Link>
              <Link to="/BossBattles" className="navButton navDropdownItem" onClick={handleNavLinkClick} target={linkTarget} rel={linkRel}>
                Boss Battles
              </Link>
              <Link to="/PatchNotes" className="navButton navDropdownItem" onClick={handleNavLinkClick} target={linkTarget} rel={linkRel}>
                Patch Notes
              </Link>
              <Link to="/SourceCode" className="navButton navDropdownItem" onClick={handleNavLinkClick} target={linkTarget} rel={linkRel}>
                Source Code
              </Link>
            </div>
          </div>
          <div className="navDropdown">
            <button className="navButton navDropdownTrigger" type="button">
              Pokémon
            </button>
            <div className="navDropdownMenu">
              <Link to="/Pokedex" className="navButton navDropdownItem" onClick={handleNavLinkClick} target={linkTarget} rel={linkRel}>
                Pokédex
              </Link>
              <Link to="/TeamPlanner" className="navButton navDropdownItem" onClick={handleNavLinkClick} target={linkTarget} rel={linkRel}>
                Team Planner
              </Link>
            </div>
          </div>
          {navButtons.map(btn => (
            <Link
              key={btn.label}
              to={btn.link}
              className={`navButton ${('hideMobile' in btn && btn.hideMobile) ? 'hide-on-mobile' : ''}`}
              onClick={handleNavLinkClick}
              target={linkTarget}
              rel={linkRel}
            >
              {btn.label}
            </Link>
          ))}
          {user && ((user.roles ?? []).some((role) => role.role_name === 'Website Dev') || user.username === 'franklynathan' || user.username === 'jage04' || user.username === 'Jason' || user.username === 'mfrazz') && (
            <Link
              to="/Admin"
              className="navButton"
              onClick={handleNavLinkClick}
              target={linkTarget}
              rel={linkRel}
            >
              Admin
            </Link>
          )}
          {!user && (
            <a href="/api/login" className="navButton" onClick={handleNavLinkClick} target={linkTarget} rel={linkRel}>Login</a>
          )}
          {user && !user.is_guest && (
            <div className="userDropdown">
              <button className="userDropdownTrigger" type="button">
                <img
                  src={`https://cdn.discordapp.com/avatars/${user.user_id}/${user.avatar}.png`}
                  alt="avatar"
                  className="userAvatar"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = '/generic/DiscordAvatar.png';
                  }}
                />
                <h1>{user.username}</h1>
              </button>
              <div className="userDropdownMenu navDropdownMenu">
                <button className="navButton userDropdownItem hide-on-mobile" onClick={() => { setShowNotes(true); handleNavLinkClick(); }}>
                  Notes
                </button>
                <button className="navButton userDropdownItem hide-on-mobile" onClick={() => { setShowSettings(true); handleNavLinkClick(); }}>
                  Settings
                </button>
                <button className="navButton userDropdownItem" onClick={() => { window.location.href = '/api/logout'; handleNavLinkClick(); }}>
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
                <button className="navButton userDropdownItem" onClick={() => { setShowNameModal(true); handleNavLinkClick(); }}>
                  Change Name
                </button>
                <button className="navButton userDropdownItem" onClick={() => { window.location.href = '/api/logout'; handleNavLinkClick(); }}>
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
      {showNotes && (
        <div className="notes-modal-overlay" onClick={() => setShowNotes(false)}>
          <div 
            className="notes-modal" 
            onClick={e => e.stopPropagation()}
            style={{
              left: `${modalPos.x}px`,
              top: `${modalPos.y}px`,
              width: `${modalSize.width}px`,
              height: `${modalSize.height}px`,
            }}
          >
            <div className="notes-modal-header" onMouseDown={(e) => {
              setIsDragging(true);
              setDragOffset({ x: e.clientX - modalPos.x, y: e.clientY - modalPos.y });
            }}>
              <h3 className="notes-modal-title">Notes</h3>
              <button 
                className="notes-modal-minimize" 
                onClick={() => setShowNotes(false)}
                title="Minimize"
              >
                _
              </button>
            </div>
            <div className="notes-toolbar">
              <button 
                type="button" 
                onMouseDown={e => e.preventDefault()} 
                onClick={() => document.execCommand('bold', false)}
                title="Bold"
              >B</button>
              <button 
                type="button" 
                onMouseDown={e => e.preventDefault()} 
                onClick={() => document.execCommand('italic', false)}
                title="Italic"
              >I</button>
              <button 
                type="button" 
                onMouseDown={e => e.preventDefault()} 
                onClick={() => document.execCommand('underline', false)}
                title="Underline"
              >U</button>
              <select 
                value={fontSize} 
                onChange={(e) => setFontSize(parseInt(e.target.value, 10))}
                title="Font Size"
              >
                {[14, 16, 18, 20, 24, 28, 32].map(size => (
                  <option key={size} value={size}>{size}px</option>
                ))}
              </select>
            </div>
            <div className="notes-modal-content">
              <div
                className="notes-editor"
                contentEditable
                suppressContentEditableWarning
                onInput={(e) => setNotes(e.currentTarget.innerHTML)}
                onKeyDown={(e) => {
                  // Stop propagation so Home.tsx space bar listener doesn't trigger
                  e.stopPropagation();
                }}
                style={{ fontSize: `${fontSize}px` }}
                ref={(el) => {
                  if (el && !el.innerHTML && notes) {
                    el.innerHTML = notes;
                  }
                }}
              />
            </div>
            <div 
              className="notes-modal-resizer" 
              onMouseDown={(e) => { e.stopPropagation(); setIsResizing(true); }}
            />
          </div>
        </div>
      )}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </header>
  );
}

export default Header;
