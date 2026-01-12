import React from 'react';
import './Header.scss';

const navButtons = [
  { label: "Auction Setup", link: "/AuctionSetup" },
  { label: "Team Planner", link: "/TeamPlanner" },
  { label: "Pokédex", link: "/Pokedex" },
  { label: "Boss Battles", link: "/BossBattles" },
  { label: "Blitz Info", link: "/Info" },
  { label: "FAQ", link: "/FAQ" },
  { label: "Patch Notes", link: "/PatchNotes" },
  { label: "Pokemon Speed Test", link: "/SpeedTest" },
];

function Header() {
  return (
    <header className="header">
      <div className="headerInner">
        <a href="/" className="logoLink">
          <img
            src="/blitzlogo.png"
            alt="Emerald Blitz Logo"
            className="logoImg"
          />
        </a>
        <nav className="nav">
          {navButtons.map(btn => (
            <a
              key={btn.label}
              href={btn.link}
              className="navButton"
            >
              {btn.label}
            </a>
          ))}
        </nav>
      </div>
    </header>
  );
}

export default Header;
