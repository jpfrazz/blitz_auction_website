import React from 'react';
import Header from '../../shared/components/Header';
import Footer from '../../shared/components/Footer';

const Home = () => (
  <>
    <Header />
    <main style={{
      minHeight: 'calc(100vh - 180px)', // adjust for header/footer
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '0 16px',
    }}>
      <img
        src="/blitzlogo.png"
        alt="Pokemon Emerald Blitz Logo"
        style={{
          width: '30vw',
          height: 'auto',
          marginBottom: '16px',
          marginTop: '16px',
        }}
      />
      <a
        href="/emeraldblitz.bps"
        className='navButton'
        download
      >
        Download Patch
      </a>
      <div style={{ color: '#fff', fontSize: '1.1rem', marginBottom: '8px' }}>
        Current Release: v8.3
      </div>
      <div style={{ color: '#ccc', fontSize: '1rem', marginBottom: '8px' }}>
        Once downloaded, apply the patch online using <a href="https://www.marcrobledo.com/RomPatcher.js/" target="_blank" rel="noopener noreferrer" style={{ color: '#4fc3f7' }}>this ROM Patcher</a>
      </div>
    </main>
    <Footer />
  </>
);

export default Home;
