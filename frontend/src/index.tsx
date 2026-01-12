import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Home from './pages/Home/Home';
import AuctionSetup from './pages/AuctionSetup/AuctionSetup';
import TeamPlanner from './pages/TeamPlanner/TeamPlanner';
import FAQ from './pages/FAQ/FAQ';
import Pokedex from './pages/Pokedex/Pokedex';
import Info from './pages/Info/Info';
import BossBattles from './pages/BossBattles/BossBattles';
import SpeedTest from './pages/SpeedTest/SpeedTest';
import './shared/style/theme.scss';

const container = document.getElementById('root');
if (container) {
  const root = ReactDOM.createRoot(container);
  root.render(
    <React.StrictMode>
      <Router>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/AuctionSetup" element={<AuctionSetup />} />
          <Route path="/TeamPlanner" element={<TeamPlanner />} />
          <Route path="/FAQ" element={<FAQ />} />
          <Route path="/Pokedex" element={<Pokedex />} />
          <Route path="/Info" element={<Info />} />
          <Route path="/BossBattles" element={<BossBattles />} />
          <Route path="/SpeedTest" element={<SpeedTest />} />
        </Routes>
      </Router>
    </React.StrictMode>
  );
} else {
  throw new Error("Root container not found");
}
