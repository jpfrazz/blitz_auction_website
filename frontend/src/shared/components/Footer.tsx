import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { getTipMessagesEnabled } from '../utils/tipMessages';
import PokeCommunityIcon from './PokeCommunityIcon';
import './Footer.scss';

const footerButtons = [
  { icon: '/generic/Github.png', alt: 'GitHub', link: 'https://github.com/FranklyNathan/EmeraldBlitz' },
  { icon: '/generic/twitter.png', alt: 'PokeCommunity', link: 'https://www.pokecommunity.com/threads/pok%C3%A9mon-emerald-blitz-hack-for-nuzlocke-races.539370/', Component: PokeCommunityIcon },
  { icon: '/generic/Youtube.png', alt: 'YouTube', link: 'https://www.youtube.com/@PkmnEmeraldBlitz' },
  { icon: '/generic/Discord.png', alt: 'Discord', link: 'https://discord.com/invite/CsUSZ5UhzW' },
//   { icon: '/generic/Download.png', alt: 'Download', link: '/Download' }, Removed while the home page is the download page
];

const DISCLAIMER_TEXT = (
  <>
    Emerald Blitz is a free, non-commercial fan project not affiliated with Nintendo, The Pokémon Company, or Game Freak. All content, images, and trademarks are the property of their respective owners.
    <br />
    This website does not run ads or accept funds. It does not host or distribute ROMs. It hosts only a bps patch file. When using its embedded mGBA emulator to play legally obtained ROMs, your ROMs never leave your device.
  </>
);

function Footer() {
  const { pathname } = useLocation();
  const [showDiscordHint, setShowDiscordHint] = useState(false);
  const [tipsEnabled, setTipsEnabled] = useState(getTipMessagesEnabled);
  const [showDisclaimer, setShowDisclaimer] = useState(true);

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

  useEffect(() => {
    if (pathname !== '/') return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        setShowDisclaimer(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [pathname]);

  return (
    <footer className={`footer ${showDisclaimer ? 'with-disclaimer' : 'no-disclaimer'}`}>
      <div className="footerInner">
        <div className="footerSocial">
          {footerButtons.map(btn => (
            <a
              key={btn.alt}
              href={btn.link}
              target="_blank"
              rel="noopener noreferrer"
              className="footerButton"
            >
              {'Component' in btn && btn.Component ? (
                <btn.Component width={30} height={30} color="currentColor" className="footerIcon" />
              ) : (
                <img src={btn.icon} alt={btn.alt} className="footerIcon" />
              )}
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
        {showDisclaimer && (
          <div className="footerDisclaimer">
            <div className="footerDisclaimerText">
              {DISCLAIMER_TEXT}
            </div>
          </div>
        )}
      </div>
    </footer>
  );
}

export default Footer;
