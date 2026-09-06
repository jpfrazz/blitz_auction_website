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

const settingsTabs = [
  { id: 'theme', label: 'Theme' },
  { id: 'auction', label: 'Auction' },
  { id: 'accessibility', label: 'Accessibility' },
] as const;

type SettingsTabId = typeof settingsTabs[number]['id'];

const SettingsModal: React.FC<SettingsModalProps> = ({ onClose }) => {
  const [activeTab, setActiveTab] = useState<SettingsTabId>('theme');

  const [primaryColor, setPrimaryColor] = useState(() => {
    return localStorage.getItem('eb-primary-color') || '#7CB946';
  });

  const [twoRowPlayerHeight, setTwoRowPlayerHeight] = useState(() => {
    return localStorage.getItem('eb-two-row-player-height') === 'true';
  });

  const [autoSortByFunds, setAutoSortByFunds] = useState(() => {
    const stored = localStorage.getItem('eb-auto-sort-by-funds');
    return stored === null ? true : stored === 'true';
  });

  const [notesHotkey, setNotesHotkey] = useState(() => {
    return localStorage.getItem('eb-notes-hotkey') || 'n';
  });

  const [tipMessages, setTipMessages] = useState(() => {
    const stored = localStorage.getItem('eb-tip-messages');
    return stored === null ? true : stored === 'true';
  });

  const [isCapturingHotkey, setIsCapturingHotkey] = useState(false);

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

  useEffect(() => {
    localStorage.setItem('eb-notes-hotkey', notesHotkey);
    window.dispatchEvent(new CustomEvent('eb-settings-changed'));
  }, [notesHotkey]);

  useEffect(() => {
    localStorage.setItem('eb-tip-messages', String(tipMessages));
    window.dispatchEvent(new CustomEvent('eb-settings-changed'));
  }, [tipMessages]);

  const handleColorChange = (color: string) => {
    setPrimaryColor(color);
  };
  const handleReset = () => handleColorChange('#7CB946');

  return (
    <div className="notes-modal-overlay" onClick={onClose} style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'center' }}>
      <div className="notes-modal" style={{ position: 'relative', width: '380px', marginTop: '10vh' }} onClick={e => e.stopPropagation()}>
        <div className="notes-modal-header" style={{ cursor: 'default' }}>
          <h2 className="notes-modal-title">Settings</h2>
          <button className="notes-modal-minimize" onClick={onClose}>×</button>
        </div>
        <div className="notes-modal-content" style={{ padding: '2rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
            {settingsTabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  flex: 1,
                  padding: '8px 0',
                  background: activeTab === tab.id ? 'var(--eb-primary, #7CB946)' : 'rgba(255,255,255,0.08)',
                  color: activeTab === tab.id ? '#111' : '#f1f1f1',
                  border: `1px solid ${activeTab === tab.id ? 'var(--eb-primary, #7CB946)' : 'rgba(255,255,255,0.15)'}`,
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontSize: '1rem',
                  fontWeight: 'bold',
                  transition: 'background 0.2s, color 0.2s, border-color 0.2s',
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab === 'theme' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px' }}>
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
                      height: '40px',
                      cursor: 'pointer',
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
            </div>
          )}

          {activeTab === 'auction' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', background: 'rgba(255,255,255,0.05)', padding: '1rem', borderRadius: '8px' }}>
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
              <div style={{ fontSize: '0.95rem', color: '#b3b3b3', marginTop: '-0.6rem' }}>
                Player row wraps to 2 rows instead of scrolling horizontally
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '0.4rem' }}>
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
              <div style={{ fontSize: '0.95rem', color: '#b3b3b3', marginTop: '-0.6rem' }}>
                Automatically sort players by remaining funds
              </div>
            </div>
          )}

          {activeTab === 'accessibility' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', background: 'rgba(255,255,255,0.05)', padding: '1rem', borderRadius: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '1.1rem' }}>Tip Messages</span>
                  <button
                    onClick={() => setTipMessages(!tipMessages)}
                    style={{
                      padding: '8px 16px',
                      background: tipMessages ? 'var(--eb-primary, #7CB946)' : '#555',
                      color: '#f1f1f1',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: '0.95rem',
                      fontWeight: 'bold',
                      transition: 'background 0.2s'
                    }}
                  >
                    {tipMessages ? 'ON' : 'OFF'}
                  </button>
                </div>
                <div style={{ fontSize: '0.95rem', color: '#b3b3b3', marginTop: '-0.6rem' }}>
                  Show helpful tip messages throughout the site
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', background: 'rgba(255,255,255,0.05)', padding: '1rem', borderRadius: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '1.1rem' }}>Notes Hotkey</span>
                  <button
                    onClick={() => setIsCapturingHotkey(true)}
                    onKeyDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
                      setNotesHotkey(key);
                      setIsCapturingHotkey(false);
                    }}
                    onBlur={() => setIsCapturingHotkey(false)}
                    style={{
                      padding: '8px 16px',
                      background: isCapturingHotkey ? 'var(--eb-primary, #7CB946)' : '#555',
                      color: '#f1f1f1',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: '0.95rem',
                      fontWeight: 'bold',
                      transition: 'background 0.2s',
                      minWidth: '60px',
                      textTransform: 'uppercase',
                    }}
                  >
                    {isCapturingHotkey ? 'Press a key...' : notesHotkey}
                  </button>
                </div>
                <div style={{ fontSize: '0.95rem', color: '#b3b3b3', marginTop: '-0.6rem' }}>
                  Key to toggle the notes panel
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;