import React from 'react';
import Header from '../../shared/components/Header';
import Footer from '../../shared/components/Footer';

const AuctionSetup = () => (
  <>
    <Header />
    <main style={{
      minHeight: 'calc(100vh - 180px)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '0 16px',
    }}>
      <img
        src="/emeraldblitz.bps"
        alt="Pokemon Emerald Blitz Logo"
        style={{
          maxWidth: '600px',
          width: '100%',
          height: 'auto',
          marginBottom: '32px',
          marginTop: '32px',
        }}
        onError={e => {
          (e.currentTarget as HTMLImageElement).src = '/blitzlogo.png';
        }}
      />
      <a
        href="/Download"
        className='navButton'
      >
        Download Patch
      </a>
      <div style={{ color: '#fff', fontSize: '1.1rem', marginBottom: '8px' }}>
        Current Release: v7.6
      </div>
      <div style={{ color: '#ccc', fontSize: '1rem', marginBottom: '8px' }}>
        Once downloaded, apply the patch online using <a href="https://www.marcrobledo.com/RomPatcher.js/" target="_blank" rel="noopener noreferrer" style={{ color: '#4fc3f7' }}>this ROM Patcher</a>
      </div>
    </main>
    <Footer />
  </>
);

export default AuctionSetup;
