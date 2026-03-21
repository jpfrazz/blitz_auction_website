import React, { useEffect, useRef, useState } from 'react';
import Header from '../../shared/components/Header';
import Footer from '../../shared/components/Footer';
import { fetchPokemonList } from '../../shared/api/pokemon';
import './Home.scss';

const formatPokemonName = (name: string) => {
  return name.toLowerCase()
    .replace(/ /g, '-')
    .replace(/[.:']/g, '')
    .replace(/♀/g, '-f')
    .replace(/♂/g, '-m');
};

const HoppingIcons = () => {
  const [icons, setIcons] = useState<any[]>([]);
  const iconsRef = useRef<any[]>([]);
  const requestRef = useRef<number>(0);
  const [availablePokemon, setAvailablePokemon] = useState<any[]>([]);

  useEffect(() => {
    let mounted = true;

    fetchPokemonList().then(list => {
      if (!mounted) return;
      // Filter for base forms to ensure icons exist
      const validList = list.filter((p: any) => !p.stage || p.stage === 'base');
      setAvailablePokemon(validList.length > 0 ? validList : list);
    }).catch(console.error);

    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    let mounted = true;

        const animate = () => {
          if (!mounted) return;

          const width = window.innerWidth;
          iconsRef.current = iconsRef.current.map(icon => {
            let { x, y, vx, vy } = icon;

            // Gravity
            vy -= 0.044; // 1/9th gravity for 1/3 speed
            x += vx;
            y += vy;

            // Ground collision
            if (y <= 0) {
              y = 0;
              // Steady jump, maintain direction
              vy = 1.3;
            }

            return { ...icon, x, y, vx, vy };
          }).filter(icon => icon.x < width + 100);

          setIcons([...iconsRef.current]);
          requestRef.current = requestAnimationFrame(animate);
        };

        requestRef.current = requestAnimationFrame(animate);

    return () => {
      mounted = false;
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, []);

  const spawnIcons = () => {
    if (availablePokemon.length === 0) return;
    const p = availablePokemon[Math.floor(Math.random() * availablePokemon.length)];
    const newIcon = {
      id: Date.now() + Math.random(),
      name: formatPokemonName(p.name),
      x: -40,
      y: 0,
      vx: 0.5,
      vy: 0,
    };
    iconsRef.current = [...iconsRef.current, newIcon];
    setIcons([...iconsRef.current]);
  };

  return (
    <div style={{
      position: 'fixed',
      bottom: 0,
      left: 0,
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
      zIndex: 100,
      overflow: 'hidden'
    }}>
      <button
        className="footerButton"
        onClick={spawnIcons}
        style={{
          position: 'absolute',
          top: '100px',
          right: '20px',
          pointerEvents: 'auto',
        }}
      >
        <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
      </button>
      {icons.map(icon => (
        <img
          key={icon.id}
          src={`/MiniIcons/${icon.name}.png`}
          alt=""
          style={{
            position: 'absolute',
            left: `${icon.x}px`,
            bottom: `${icon.y + 65}px`,
            imageRendering: 'pixelated'
          }}
          onError={(e) => e.currentTarget.style.display = 'none'}
        />
      ))}
    </div>
  );
};

const Home = () => {
  const [isLoaded, setIsLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (imgRef.current?.complete) {
      setIsLoaded(true);
    }
  }, []);

  return (
    <div className="home-page">
      <Header />
      <HoppingIcons />
      <main className={`home-main ${isLoaded ? 'visible' : ''}`}>
        <img
          ref={imgRef}
          src="/blitzlogo.png"
          alt="Pokemon Emerald Blitz Logo"
          className={`home-logo ${isLoaded ? 'animate' : ''}`}
          onLoad={() => setIsLoaded(true)}
        />
        <div className={`home-actions ${isLoaded ? 'animate' : ''}`}>
          <div className="home-version-pill">
            Current Release: v8.31
          </div>
          <a
            href="/emeraldblitz.bps"
            className='home-download-btn'
            download
          >
            Download Patch
          </a>
          <div className="home-instructions">
            Once downloaded, apply the patch online using <a href="https://www.marcrobledo.com/RomPatcher.js/" target="_blank" rel="noopener noreferrer">this ROM Patcher</a>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default Home;
