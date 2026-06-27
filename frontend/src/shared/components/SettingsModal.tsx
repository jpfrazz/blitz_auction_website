import React, { useState, useEffect } from 'react';

interface SettingsModalProps {
  onClose: () => void;
}

const predefinedThemes = [
  { color: '#7CB946' }, // Emerald
  { color: '#36A2EB' }, // Sapphire
  { color: '#FFCE56' }, // Gold
  { color: '#9966FF' }, // Amethyst
  { color: '#FF9F40' }, // Blaze
  { color: '#5247FF' }, // Deep Blue
  { color: '#F06292' }, // Pink
  { color: '#b7b8b6' }, // Grey
];

const SettingsModal: React.FC<SettingsModalProps> = ({ onClose }) => {
  const [primaryColor, setPrimaryColor] = useState(() => {
    return localStorage.getItem('eb-primary-color') || '#7CB946';
  });

  const [twoRowPlayerHeight, setTwoRowPlayerHeight] = useState(() => {
    return localStorage.getItem('eb-two-row-player-height') === 'true';
  });

  const [autoSortByFunds, setAutoSortByFunds] = useState(() => {
    return localStorage.getItem('eb-auto-sort-by-funds') === 'true';
  });

  useEffect(() => {
    document.documentElement.style.setProperty('--eb-primary', primaryColor);
    localStorage.setItem('eb-primary-color', primaryColor);
  }, [primaryColor]);

  useEffect(() => {
    localStorage.setItem('eb-two-row-player-height', String(twoRowPlayerHeight));
    window.dispatchEvent(new CustomEvent('eb-settings-changed'));
  }, [twoRowPlayerHeight]);

  useEffect(() => {
    localStorage.setItem('eb-auto-sort-by-funds', String(autoSortByFunds));
    window.dispatchEvent(new CustomEvent('eb-settings-changed'));
  }, [autoSortByFunds]);

  const handleColorChange = (color: string) => {
    setPrimaryColor(color);
  };
  const handleReset = () => handleColorChange('#7CB946');

  return (
    <div className="notes-modal-overlay" onClick={onClose} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="notes-modal" style={{ position: 'relative', width: '380px' }} onClick={e => e.stopPropagation()}>
        <div className="notes-modal-header">
          <h2 className="notes-modal-title">Settings</h2>
          <button className="notes-modal-minimize" onClick={onClose}>×</button>
        </div>
        <div className="notes-modal-content" style={{ padding: '2rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <label style={{ fontSize: '1.4rem', color: '#b0b0b0', fontWeight: 'bold', marginBottom: '0.5rem' }}>Theme</label>
            
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', marginBottom: '1.5rem' }}>
              {predefinedThemes.map((theme) => (
                <button
                  key={theme.color}
                  onClick={() => handleColorChange(theme.color)}
                  style={{
                    background: theme.color,
                    color: '#111',
                    border: primaryColor === theme.color ? '2px solid white' : '1px solid #444',
                    borderRadius: '8px',
                    padding: '12px 5px',
                    height: '40px',                    cursor: 'pointer',
                    fontWeight: 'bold',
                    fontSize: '1rem',
                    transition: 'all 0.2s ease',
                    boxShadow: primaryColor === theme.color ? '0 0 10px rgba(255,255,255,0.5)' : 'none',
                  }}
                />
              ))}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', background: 'rgba(255,255,255,0.05)', padding: '1rem', borderRadius: '8px' }}>
              <span style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>Custom Color</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', width: '100%' }}>
                <input 
                  type="color" 
                  value={primaryColor} 
                  onChange={(e) => handleColorChange(e.target.value)}
                  style={{ width: '40px', height: '40px', border: 'none', cursor: 'pointer', background: 'transparent' }}
                />
                <input type="text" value={primaryColor} onChange={(e) => handleColorChange(e.target.value)} style={{ flexGrow: 1, padding: '8px', borderRadius: '4px', border: '1px solid #444', background: '#111', color: '#f1f1f1', fontSize: '1rem' }} />
                <button onClick={handleReset} style={{ padding: '8px 12px', fontSize: '0.9rem', opacity: 0.8, background: '#555', color: '#f1f1f1', borderRadius: '8px' }}>Reset</button>
              </div>
            </div>

            <label style={{ fontSize: '1.4rem', color: '#b0b0b0', fontWeight: 'bold', marginBottom: '0.5rem' }}>Player Row Settings</label>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', background: 'rgba(255,255,255,0.05)', padding: '1rem', borderRadius: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '1.1rem' }}>Two-Row Player Height</span>
                <button
                  onClick={() => setTwoRowPlayerHeight(!twoRowPlayerHeight)}
                  style={{
                    padding: '8px 16px',
                    background: twoRowPlayerHeight ? 'var(--eb-primary, #7CB946)' : '#555',
                    color: '#f1f1f1',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '0.95rem',
                    fontWeight: 'bold',
                    transition: 'background 0.2s'
                  }}
                >
                  {twoRowPlayerHeight ? 'ON' : 'OFF'}
                </button>
              </div>
              <div style={{ fontSize: '0.95rem', color: '#888', marginTop: '-0.5rem' }}>
                Player row wraps to 2 rows instead of scrolling horizontally
              </div>
              
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '0.5rem' }}>
                <span style={{ fontSize: '1.1rem' }}>Auto-Sort by Funds</span>
                <button
                  onClick={() => setAutoSortByFunds(!autoSortByFunds)}
                  style={{
                    padding: '8px 16px',
                    background: autoSortByFunds ? 'var(--eb-primary, #7CB946)' : '#555',
                    color: '#f1f1f1',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '0.95rem',
                    fontWeight: 'bold',
                    transition: 'background 0.2s'
                  }}
                >
                  {autoSortByFunds ? 'ON' : 'OFF'}
                </button>
              </div>
              <div style={{ fontSize: '0.95rem', color: '#888', marginTop: '-0.5rem' }}>
                Automatically sort players by remaining funds
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;