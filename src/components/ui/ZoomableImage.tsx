import React, { useEffect, useRef, useState } from 'react';

/**
 * Photo principale : au survol, loupe centrée sur la souris ; la molette
 * augmente / diminue le grossissement. Un clic ouvre la photo en plein écran.
 */
export const ZoomableImage: React.FC<{ src: string; alt: string; onOpen: () => void; fit?: 'contain' | 'cover' }> = ({
  src,
  alt,
  onOpen,
  fit = 'contain',
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState(false);
  const [origin, setOrigin] = useState({ x: 50, y: 50 });
  const [scale, setScale] = useState(2.5);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setScale((s) => Math.min(6, Math.max(1.5, s - e.deltaY * 0.003)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setOrigin({ x: ((e.clientX - rect.left) / rect.width) * 100, y: ((e.clientY - rect.top) / rect.height) * 100 });
  };

  return (
    <div
      ref={ref}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onMouseMove={onMove}
      onClick={onOpen}
      className="h-full w-full cursor-zoom-in overflow-hidden"
    >
      <img
        src={src}
        alt={alt}
        draggable={false}
        className={`h-full w-full select-none transition-transform duration-75 ${fit === 'cover' ? 'object-cover' : 'object-contain'}`}
        style={{ transform: hover ? `scale(${scale})` : 'none', transformOrigin: `${origin.x}% ${origin.y}%` }}
      />
    </div>
  );
};

export default ZoomableImage;
