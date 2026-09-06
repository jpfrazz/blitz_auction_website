import React, { useCallback, useEffect, useState } from 'react';
import { getTipMessagesEnabled } from '../utils/tipMessages';
import './HoverTip.scss';

const TIP_WIDTH = 340;

interface HoverTipProps {
  text: string;
  color: string;
  anchorRef: React.RefObject<HTMLElement | null>;
  hover: boolean;
}

const HoverTip: React.FC<HoverTipProps> = ({ text, color, anchorRef, hover }) => {
  const [tipsEnabled, setTipsEnabled] = useState(getTipMessagesEnabled);
  const [bubbleHovered, setBubbleHovered] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const measure = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const margin = 12;
    let left = rect.left + rect.width / 2 - TIP_WIDTH / 2;
    left = Math.max(margin, Math.min(left, window.innerWidth - TIP_WIDTH - margin));
    setPos({ top: rect.top - 22, left });
  }, [anchorRef]);

  useEffect(() => {
    measure();
    window.addEventListener('resize', measure);
    const handleSettingsChanged = () => setTipsEnabled(getTipMessagesEnabled());
    window.addEventListener('eb-settings-changed', handleSettingsChanged);
    window.addEventListener('storage', handleSettingsChanged);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('eb-settings-changed', handleSettingsChanged);
      window.removeEventListener('storage', handleSettingsChanged);
    };
  }, [measure]);

  useEffect(() => {
    if (hover) measure();
  }, [hover, measure]);

  if (!tipsEnabled || !pos || !anchorRef.current || (!hover && !bubbleHovered)) return null;

  return (
    <div
      className="hover-tip"
      style={{ top: pos.top, left: pos.left, '--tip-color': color } as React.CSSProperties}
      onMouseEnter={() => setBubbleHovered(true)}
      onMouseLeave={() => setBubbleHovered(false)}
    >
      {text}
    </div>
  );
};

export default HoverTip;