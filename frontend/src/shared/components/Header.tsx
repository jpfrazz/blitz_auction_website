import React, { useEffect, useState } from 'react';
import './Header.scss';
import { Link } from 'react-router-dom';
import { fetchCurrentUser } from '../api/draftData';

const navButtons = [
  // { label: "Team Planner", link: "/TeamPlanner" },
  { label: "Pokédex", link: "/Pokedex" },
  { label: "Boss Battles", link: "/BossBattles" },
  { label: "Blitz Info", link: "/Info" },
  { label: "FAQ", link: "/FAQ" },
  { label: "Patch Notes", link: "/PatchNotes" },
];

function Header() {
  const scrollToTop = () => {
    window.scrollTo(0, 0);
  };

  type UserState =
    | { is_guest: boolean; user_id: string; username: string; avatar?: string };
  const [user, setUser] = useState<UserState | null>(null);
  useEffect(() => {
    fetchCurrentUser().then(user => setUser(user)).catch(() => setUser(null));
  }, []);

  return (
    <header className="header">
      <div className="headerInner">
        <Link to="/" className="logoLink" onClick={scrollToTop}>
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
              <Link to="/AuctionSetup" className="navButton navDropdownItem" onClick={scrollToTop}>
                Auction Setup
              </Link>
              <Link to="/LobbyViewer" className="navButton navDropdownItem" onClick={scrollToTop}>
                Lobby Viewer
              </Link>
            </div>
          </div>
          {navButtons.map(btn => (
            <Link
              key={btn.label}
              to={btn.link}
              className="navButton"
              onClick={scrollToTop}
            >
              {btn.label}
            </Link>
          ))}
          {!user && (
            <a href="/api/login" className="navButton">Login</a>
          )}
          {user && !user.is_guest && (
            <div className="userInfo">
              <img
                src={`https://cdn.discordapp.com/avatars/${user.user_id}/${user.avatar}.png`}
                alt="avatar"
                className="userAvatar"
              />
              <h1>{user.username}</h1>
            </div>
          )}
          {user && user.is_guest && (
            <div className="userInfo">
              <h1>{user.username}</h1>
            </div>
          )}
        </nav>
      </div>
    </header>
  );
}

export default Header;
