import React from 'react';
import './Footer.scss';

const footerButtons = [
  { icon: '/generic/Github.png', alt: 'GitHub', link: 'https://github.com/FranklyNathan/EmeraldBlitz' },
  { icon: '/generic/Twitch.png', alt: 'Twitch', link: 'https://www.twitch.tv/emeraldblitzlive' },
  { icon: '/generic/Youtube.png', alt: 'YouTube', link: 'https://www.youtube.com/@PkmnEmeraldBlitz' },
  { icon: '/generic/Discord.png', alt: 'Discord', link: 'https://discord.com/invite/CsUSZ5UhzW' },
//   { icon: '/generic/Download.png', alt: 'Download', link: '/Download' }, Removed while the home page is the download page
];

function Footer() {
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
      </div>
    </footer>
  );
}

export default Footer;
