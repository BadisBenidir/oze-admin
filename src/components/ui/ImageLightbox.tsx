import React, { useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';

interface ImageLightboxProps {
  images: string[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  alt?: string;
}

/** Visionneuse plein écran : flèches (écran + clavier ←/→), Échap pour
 * fermer, balayage sur mobile, bande de miniatures pour sauter directement
 * à une photo. */
export const ImageLightbox: React.FC<ImageLightboxProps> = ({ images, index, onIndexChange, onClose, alt }) => {
  const count = images.length;
  const touchStartX = useRef<number | null>(null);
  const activeThumbRef = useRef<HTMLButtonElement | null>(null);

  const prev = () => onIndexChange((index - 1 + count) % count);
  const next = () => onIndexChange((index + 1) % count);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft' && count > 1) onIndexChange((index - 1 + count) % count);
      else if (e.key === 'ArrowRight' && count > 1) onIndexChange((index + 1) % count);
    };
    window.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [index, count, onIndexChange, onClose]);

  useEffect(() => {
    activeThumbRef.current?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }, [index]);

  if (!images[index]) return null;

  const navButton = 'absolute top-1/2 -translate-y-1/2 h-11 w-11 flex items-center justify-center rounded-full bg-white/10 text-white/90 hover:bg-white/20 hover:text-white transition-colors';

  return (
    <div
      className="fixed inset-0 z-[80] bg-black/95 flex flex-col"
      onClick={onClose}
      onTouchStart={(e) => { touchStartX.current = e.touches[0].clientX; }}
      onTouchEnd={(e) => {
        if (touchStartX.current == null || count < 2) return;
        const dx = e.changedTouches[0].clientX - touchStartX.current;
        touchStartX.current = null;
        if (Math.abs(dx) > 50) (dx > 0 ? prev : next)();
      }}
    >
      <div className="flex items-center justify-between px-4 py-3 text-white/80 text-sm">
        <span>{count > 1 ? `${index + 1} / ${count}` : ''}</span>
        <button onClick={onClose} className="p-2 hover:text-white rounded-lg transition-colors" aria-label="Fermer">
          <X className="h-6 w-6" />
        </button>
      </div>

      <div className="relative flex-1 min-h-0 flex items-center justify-center px-4 sm:px-16">
        <img
          src={images[index]}
          alt={alt}
          className="max-h-full max-w-full object-contain select-none"
          onClick={(e) => e.stopPropagation()}
          draggable={false}
        />
        {count > 1 && (
          <>
            <button onClick={(e) => { e.stopPropagation(); prev(); }} className={`${navButton} left-2 sm:left-4`} aria-label="Photo précédente">
              <ChevronLeft className="h-6 w-6" />
            </button>
            <button onClick={(e) => { e.stopPropagation(); next(); }} className={`${navButton} right-2 sm:right-4`} aria-label="Photo suivante">
              <ChevronRight className="h-6 w-6" />
            </button>
          </>
        )}
      </div>

      {count > 1 && (
        <div className="flex gap-2 overflow-x-auto px-4 py-3 justify-start sm:justify-center" onClick={(e) => e.stopPropagation()}>
          {images.map((src, i) => (
            <button
              key={i}
              ref={i === index ? activeThumbRef : undefined}
              onClick={() => onIndexChange(i)}
              className={`h-14 w-14 flex-shrink-0 rounded-md overflow-hidden border-2 transition-all ${i === index ? 'border-white' : 'border-transparent opacity-60 hover:opacity-100'}`}
            >
              <img src={src} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default ImageLightbox;
