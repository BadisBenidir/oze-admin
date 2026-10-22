import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Download, ImageOff, Loader2, X } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import type { Drop } from '../../../hooks/useDrops';
import logoWhite from '../../landing/assets/logo_oze_paris_b2b_white.png';

/**
 * Image de couverture TikTok d'un drop (1080 × 1920), générée dans le
 * navigateur (canvas) à partir des photos des pièces : fond noir, logo OZË,
 * « DROP B2B », titre, date, mosaïque de 1 à 6 photos, nombre de pièces.
 * Les informations restent hors des zones recouvertes par l'interface TikTok
 * (bas de l'écran, colonne d'icônes à droite). Options : photos floutées
 * (teaser) et « sans texte » (zone haute épurée pour écrire dans TikTok).
 * Les photos du stockage Supabase sont servies avec CORS (*) : le canvas
 * reste exportable en PNG.
 */

const W = 1080;
const H = 1920;
const MAX_PHOTOS = 6;

interface DropPiece {
  id: string;
  name: string;
  brand: string | null;
  image: string | null;
}

const loadImage = (src: string): Promise<HTMLImageElement | null> =>
  new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });

const roundRect = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
};

/** Photo en « cover » dans une tuile arrondie à fond blanc. */
const drawTile = (ctx: CanvasRenderingContext2D, img: HTMLImageElement | null, x: number, y: number, w: number, h: number, blur: boolean) => {
  ctx.save();
  roundRect(ctx, x, y, w, h, 28);
  ctx.clip();
  ctx.fillStyle = '#f4f4f2';
  ctx.fillRect(x, y, w, h);
  if (img) {
    const scale = Math.max(w / img.width, h / img.height) * 0.92;
    const dw = img.width * scale;
    const dh = img.height * scale;
    if (blur) ctx.filter = 'blur(22px)';
    ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
    ctx.filter = 'none';
  }
  ctx.restore();
};

/** Positions des tuiles selon le nombre de photos (zone x 70→1010, y top→bottom). */
const layoutTiles = (n: number, top: number, bottom: number) => {
  const left = 70;
  const right = 1010;
  const gap = 24;
  const width = right - left;
  const height = bottom - top;
  if (n <= 1) return [{ x: left, y: top, w: width, h: height }];
  if (n === 2) {
    const h = (height - gap) / 2;
    return [0, 1].map((i) => ({ x: left, y: top + i * (h + gap), w: width, h }));
  }
  if (n === 3) {
    const bigH = (height - gap) * 0.58;
    const smallH = height - gap - bigH;
    const halfW = (width - gap) / 2;
    return [
      { x: left, y: top, w: width, h: bigH },
      { x: left, y: top + bigH + gap, w: halfW, h: smallH },
      { x: left + halfW + gap, y: top + bigH + gap, w: halfW, h: smallH },
    ];
  }
  const cols = 2;
  const rows = Math.ceil(n / cols);
  const cw = (width - gap) / cols;
  const ch = (height - gap * (rows - 1)) / rows;
  return Array.from({ length: n }, (_, i) => ({ x: left + (i % cols) * (cw + gap), y: top + Math.floor(i / cols) * (ch + gap), w: cw, h: ch }));
};

const wrapText = (ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] => {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else line = test;
  }
  if (line) lines.push(line);
  return lines.slice(0, 2);
};

export const DropTikTokCoverModal: React.FC<{ drop: Drop; onClose: () => void }> = ({ drop, onClose }) => {
  const [pieces, setPieces] = useState<DropPiece[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const date = new Date(drop.scheduled_at);
  const defaultSubtitle = `${date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })} · ${date
    .toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    .replace(':', 'h')}`;
  const [headline, setHeadline] = useState(drop.title?.trim() || 'Nouveau drop');
  const [subtitle, setSubtitle] = useState(defaultSubtitle.charAt(0).toUpperCase() + defaultSubtitle.slice(1));
  const [blur, setBlur] = useState(false);
  const [noText, setNoText] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageCache = useRef(new Map<string, HTMLImageElement | null>());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from('products')
        .select('id, name, images, main_image_index, brand:brands(name)')
        .in('id', drop.product_ids.length ? drop.product_ids : ['00000000-0000-0000-0000-000000000000']);
      if (cancelled) return;
      const byId = new Map((data || []).map((p) => [p.id, p]));
      // Pièces en vitrine d'abord, puis l'ordre du drop.
      const order = [...(drop.featured_product_ids || []), ...drop.product_ids.filter((id) => !(drop.featured_product_ids || []).includes(id))];
      const list = order
        .map((id) => byId.get(id))
        .filter((p): p is NonNullable<typeof p> => Boolean(p))
        .map((p) => {
          const brand = p.brand as unknown as { name: string } | null;
          return { id: p.id, name: p.name, brand: brand?.name ?? null, image: p.images?.[p.main_image_index ?? 0] || p.images?.[0] || null };
        });
      setPieces(list);
      setSelected(list.filter((p) => p.image).slice(0, 4).map((p) => p.id));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [drop.id, drop.product_ids, drop.featured_product_ids]);

  const brands = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of pieces) if (p.brand) counts.set(p.brand, (counts.get(p.brand) || 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([b]) => b).slice(0, 3);
  }, [pieces]);

  // Rendu du canvas à chaque changement.
  useEffect(() => {
    if (loading) return;
    let cancelled = false;
    (async () => {
      setRendering(true);
      const canvas = canvasRef.current || document.createElement('canvas');
      canvasRef.current = canvas;
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const getImg = async (src: string) => {
        if (!imageCache.current.has(src)) imageCache.current.set(src, await loadImage(src));
        return imageCache.current.get(src) ?? null;
      };
      const chosen = selected.map((id) => pieces.find((p) => p.id === id)).filter((p): p is DropPiece => Boolean(p));
      const imgs = await Promise.all(chosen.map((p) => (p.image ? getImg(p.image) : Promise.resolve(null))));
      const logo = await getImg(logoWhite);
      if (cancelled) return;

      // Fond noir avec léger dégradé.
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, '#141414');
      bg.addColorStop(0.5, '#0a0a0a');
      bg.addColorStop(1, '#000000');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      // Logo en haut.
      if (logo) {
        const lw = 230;
        const lh = (logo.height / logo.width) * lw;
        ctx.drawImage(logo, (W - lw) / 2, 110, lw, lh);
      }

      ctx.textAlign = 'center';
      let photosTop = 330;
      if (!noText) {
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.font = '600 34px Helvetica, Arial, sans-serif';
        ctx.fillText('D R O P   B 2 B', W / 2, 330);

        ctx.fillStyle = '#ffffff';
        ctx.font = '700 104px Georgia, "Times New Roman", serif';
        const lines = wrapText(ctx, headline || 'Nouveau drop', 940);
        lines.forEach((l, i) => ctx.fillText(l, W / 2, 450 + i * 112));
        const afterTitle = 450 + (lines.length - 1) * 112;

        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.font = '400 46px Helvetica, Arial, sans-serif';
        ctx.fillText(subtitle, W / 2, afterTitle + 78);
        photosTop = afterTitle + 140;
      }

      // Mosaïque (bas de la zone sûre TikTok ≈ 1560).
      const photosBottom = noText ? 1560 : 1440;
      const tiles = layoutTiles(Math.max(1, chosen.length), photosTop, photosBottom);
      tiles.forEach((t, i) => drawTile(ctx, imgs[i] ?? null, t.x, t.y, t.w, t.h, blur));

      if (!noText) {
        ctx.fillStyle = '#ffffff';
        ctx.font = '600 44px Helvetica, Arial, sans-serif';
        const count = drop.product_ids.length;
        ctx.fillText(`${count} pièce${count > 1 ? 's' : ''} de luxe${brands.length ? ` · ${brands.join(' · ')}` : ''}`, W / 2, 1520);
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.font = '400 34px Helvetica, Arial, sans-serif';
        ctx.fillText('Réservé aux revendeurs · pro.ozeparis.com', W / 2, 1578);
      }

      setPreview(canvas.toDataURL('image/png'));
      setRendering(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [loading, selected, headline, subtitle, blur, noText, pieces, brands, drop.product_ids.length]);

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= MAX_PHOTOS ? prev : [...prev, id]));

  const download = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tiktok-drop-${drop.scheduled_at.slice(0, 10)}.png`;
      a.click();
      URL.revokeObjectURL(url);
    }, 'image/png');
  };

  const input = 'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none';

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative flex w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-xl md:flex-row" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-center bg-gray-100 p-4 md:w-[380px]">
            {preview ? (
              <img src={preview} alt="Aperçu de l'image TikTok" className="w-full max-w-[320px] rounded-lg shadow-lg" />
            ) : (
              <div className="flex aspect-[9/16] w-full max-w-[320px] items-center justify-center rounded-lg bg-gray-200">
                <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
              </div>
            )}
          </div>

          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-center justify-between border-b border-gray-100 p-5">
              <div>
                <h3 className="text-base font-semibold text-gray-900">Image TikTok du drop</h3>
                <p className="text-xs text-gray-500">Format vertical 1080 × 1920, à mettre en première image de ta vidéo.</p>
              </div>
              <button type="button" onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto p-5" style={{ maxHeight: '70vh' }}>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={noText} onChange={(e) => setNoText(e.target.checked)} className="h-4 w-4 accent-gray-900" />
                Sans texte (j'écris par-dessus dans TikTok)
              </label>
              {!noText && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600">Titre</label>
                    <input value={headline} onChange={(e) => setHeadline(e.target.value)} maxLength={40} className={input} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600">Sous-titre</label>
                    <input value={subtitle} onChange={(e) => setSubtitle(e.target.value)} maxLength={45} className={input} />
                  </div>
                </div>
              )}
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={blur} onChange={(e) => setBlur(e.target.checked)} className="h-4 w-4 accent-gray-900" />
                Flouter les photos (teaser)
              </label>

              <div>
                <p className="mb-2 text-xs font-medium text-gray-600">
                  Photos ({selected.length}/{MAX_PHOTOS}) — clique pour choisir, l'ordre de sélection est l'ordre d'affichage
                </p>
                {loading ? (
                  <p className="text-sm text-gray-500">Chargement des pièces…</p>
                ) : (
                  <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                    {pieces.map((p) => {
                      const index = selected.indexOf(p.id);
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => toggle(p.id)}
                          disabled={!p.image}
                          title={p.name}
                          className={`relative aspect-square overflow-hidden rounded-lg border-2 ${index >= 0 ? 'border-gray-900' : 'border-transparent'} bg-gray-100 disabled:opacity-40`}
                        >
                          {p.image ? (
                            <img src={p.image} alt={p.name} className="h-full w-full object-cover" />
                          ) : (
                            <ImageOff className="m-auto h-4 w-4 text-gray-300" />
                          )}
                          {index >= 0 && (
                            <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-gray-900 text-[11px] font-semibold text-white">
                              {index + 1}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-gray-100 p-5">
              {rendering && <span className="flex items-center gap-1.5 text-xs text-gray-400"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Mise à jour…</span>}
              <button type="button" onClick={onClose} className="rounded-lg bg-gray-100 px-4 py-2 text-sm text-gray-700 hover:bg-gray-200">
                Fermer
              </button>
              <button
                type="button"
                onClick={download}
                disabled={!preview || rendering}
                className="flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
              >
                {preview && !rendering ? <Download className="h-4 w-4" /> : <Check className="h-4 w-4" />}
                Télécharger (PNG)
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DropTikTokCoverModal;
