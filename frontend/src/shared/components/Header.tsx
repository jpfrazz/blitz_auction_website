import React from 'react';
import './Header.scss';
import { Link } from 'react-router-dom';

const navButtons = [
  // { label: "Team Planner", link: "/TeamPlanner" },
  { label: "Pokédex", link: "/Pokedex" },
  { label: "Boss Battles", link: "/BossBattles" },
  { label: "Blitz Info", link: "/Info" },
  { label: "FAQ", link: "/FAQ" },
  { label: "Patch Notes", link: "/PatchNotes" },
];

function Header() {
  return (
    <header className="header">
      <div className="headerInner">
        <Link to="/" className="logoLink">
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
              <Link to="/AuctionSetup" className="navButton navDropdownItem">
                Auction Setup
              </Link>
              <Link to="/LobbyViewer" className="navButton navDropdownItem">
                Lobby Viewer
              </Link>
            </div>
          </div>
          {navButtons.map(btn => (
            <Link
              key={btn.label}
              to={btn.link}
              className="navButton"
            >
              {btn.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}

export default Header;
