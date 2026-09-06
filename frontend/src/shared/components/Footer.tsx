import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { getTipMessagesEnabled } from '../utils/tipMessages';
import './Footer.scss';

const footerButtons = [
  { icon: '/generic/Github.png', alt: 'GitHub', link: 'https://github.com/FranklyNathan/EmeraldBlitz' },
  { icon: '/generic/twitter.png', alt: 'Twitter', link: 'https://x.com/P_Emerald_Blitz' },
  { icon: '/generic/Youtube.png', alt: 'YouTube', link: 'https://www.youtube.com/@PkmnEmeraldBlitz' },
  { icon: '/generic/Discord.png', alt: 'Discord', link: 'https://discord.com/invite/CsUSZ5UhzW' },
//   { icon: '/generic/Download.png', alt: 'Download', link: '/Download' }, Removed while the home page is the download page
];

function Footer() {
  const { pathname } = useLocation();
  const [showDiscordHint, setShowDiscordHint] = useState(false);
  const [tipsEnabled, setTipsEnabled] = useState(getTipMessagesEnabled);

  useEffect(() => {
    const handleSettingsChanged = () => setTipsEnabled(getTipMessagesEnabled());
    window.addEventListener('eb-settings-changed', handleSettingsChanged);
    window.addEventListener('storage', handleSettingsChanged);
    return () => {
      window.removeEventListener('eb-settings-changed', handleSettingsChanged);
      window.removeEventListener('storage', handleSettingsChanged);
    };
  }, []);

  useEffect(() => {
    if (pathname !== '/' || !tipsEnabled) {
      setShowDiscordHint(false);
      return;
    }
    const timer = setTimeout(() => setShowDiscordHint(true), 3000);
    return () => clearTimeout(timer);
  }, [pathname, tipsEnabled]);

  return (
    <footer className="footer">
      <div className="footerInner">
        {footerButtons.map(btn => (
          <a
            key={btn.alt}
            href={btn.link}
            target="_blank"
            rel="noopener noreferrer"
            className="footerButton"
          >
            <img src={btn.icon} alt={btn.alt} className="footerIcon" />
          </a>
        ))}
        {showDiscordHint && (
          <div className="discord-hint">
            <button
              className="discord-hint-close"
              onClick={() => setShowDiscordHint(false)}
              aria-label="Close"
            >
              -
            </button>
            Join the discord for daily races!
          </div>
        )}
      </div>
    </footer>
  );
}

export default Footer;
