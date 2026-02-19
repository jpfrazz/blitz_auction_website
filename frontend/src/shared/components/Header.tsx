import React from 'react';
import './Header.scss';
import { Link } from 'react-router-dom';

const navButtons = [
  { label: "Auction Setup", link: "/AuctionSetup" },
  { label: "Team Planner", link: "/TeamPlanner" },
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
