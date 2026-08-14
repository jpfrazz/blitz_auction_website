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
  const [showHint, setShowHint] = useState(false);
  const hasPressedSpace = useRef(false);

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

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!hasPressedSpace.current) {
        setShowHint(true);
      }
    }, 10000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        hasPressedSpace.current = true;
        setShowHint(false);
        spawnIcons();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [availablePokemon]);

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
      <div className={`space-hint ${showHint ? 'visible' : ''}`}>
        Press the space bar!
      </div>
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
            Current Release: v1.0.6
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
