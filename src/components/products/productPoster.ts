/**
 * Dessin (canvas) de l'affiche promotionnelle d'un article — voir ProductPosterModal.
 * Séparé du composant pour pouvoir être rendu et vérifié hors React.
 */

export type Format = 'post' | 'story' | 'square';

export const FORMATS: Record<Format, { label: string; hint: string; w: number; h: number }> = {
  post: { label: 'Post', hint: '4:5', w: 1080, h: 1350 },
  story: { label: 'Story', hint: '9:16', w: 1080, h: 1920 },
  square: { label: 'Carré', hint: '1:1', w: 1080, h: 1080 },
};

const COLORS = {
  bg: '#F5F2EC',
  ink: '#111111',
  muted: '#6B6B6B',
  line: '#E4DED3',
  card: '#FFFFFF',
  sale: '#B42318',
};

const SANS = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const SERIF = '"Bodoni 72", Didot, "Playfair Display", Georgia, serif';

export const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Image introuvable : ${src}`));
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

/** Coupe un texte en lignes tenant dans `maxWidth`, au plus `maxLines` (avec « … »). */
const wrapText = (ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number) => {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (ctx.measureText(test).width <= maxWidth || !current) current = test;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    let last = kept[maxLines - 1];
    while (ctx.measureText(`${last}…`).width > maxWidth && last.length > 1) last = last.slice(0, -1);
    kept[maxLines - 1] = `${last.trimEnd()}…`;
    return kept;
  }
  return lines;
};

export const euro = (n: number) =>
  `${n.toLocaleString('fr-FR', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })} €`;

/** Pastille arrondie (contour ou pleine) ; renvoie sa largeur. */
const pill = (
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  opts: { filled?: boolean; size?: number; color?: string } = {}
) => {
  const size = opts.size ?? 26;
  ctx.font = `600 ${size}px ${SANS}`;
  const padX = size * 0.9;
  const h = size * 2;
  const w = ctx.measureText(text).width + padX * 2;
  roundRect(ctx, x, y, w, h, h / 2);
  if (opts.filled) {
    ctx.fillStyle = opts.color ?? COLORS.ink;
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
  } else {
    ctx.lineWidth = 2;
    ctx.strokeStyle = opts.color ?? COLORS.ink;
    ctx.stroke();
    ctx.fillStyle = opts.color ?? COLORS.ink;
  }
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + padX, y + h / 2 + 1);
  ctx.textBaseline = 'alphabetic';
  return w;
};

export async function drawPoster(
  canvas: HTMLCanvasElement,
  format: Format,
  data: { name: string; brand?: string | null; condition?: string | null; price: number | null; originalPrice?: number | null; image: HTMLImageElement | null; logo: HTMLImageElement | null }
) {
  const { w, h } = FORMATS[format];
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const M = 72; // marge extérieure

  // Fond
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, w, h);

  // Logo
  let y = format === 'story' ? 110 : 64;
  if (data.logo) {
    const lh = format === 'square' ? 84 : 104;
    const lw = (data.logo.width / data.logo.height) * lh;
    ctx.drawImage(data.logo, (w - lw) / 2, y, lw, lh);
    y += lh;
  }
  y += format === 'square' ? 34 : 48;

  // Zone texte réservée en bas : on donne le reste à la photo
  const textBlock = format === 'square' ? 290 : 330;
  const footer = format === 'story' ? 190 : 140;
  const photoH = h - y - textBlock - footer;
  const photoW = format === 'square' ? photoH : w - M * 2;
  const photoX = (w - photoW) / 2;

  // Carte photo (ombre douce + coins arrondis), image en "cover"
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.10)';
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 16;
  roundRect(ctx, photoX, y, photoW, photoH, 36);
  ctx.fillStyle = COLORS.card;
  ctx.fill();
  ctx.restore();
  if (data.image) {
    ctx.save();
    roundRect(ctx, photoX, y, photoW, photoH, 36);
    ctx.clip();
    const scale = Math.max(photoW / data.image.width, photoH / data.image.height);
    const iw = data.image.width * scale;
    const ih = data.image.height * scale;
    ctx.drawImage(data.image, photoX + (photoW - iw) / 2, y + (photoH - ih) / 2, iw, ih);
    ctx.restore();
  }

  // Badge « Authentifié » sur la photo — coche dessinée (le glyphe ✓ manque dans
  // certaines polices et s'afficherait en carré vide).
  const badgeX = photoX + 28;
  const badgeY = y + 28;
  pill(ctx, '     AUTHENTIFIÉ', badgeX, badgeY, { filled: true, size: 22 });
  ctx.save();
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 3.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(badgeX + 22, badgeY + 22);
  ctx.lineTo(badgeX + 29, badgeY + 29);
  ctx.lineTo(badgeX + 42, badgeY + 15);
  ctx.stroke();
  ctx.restore();

  y += photoH + 48;

  // Marque
  const left = format === 'square' ? photoX : M;
  const right = w - left;
  if (data.brand) {
    ctx.fillStyle = COLORS.muted;
    ctx.font = `600 26px ${SANS}`;
    ctx.letterSpacing = '6px';
    ctx.fillText(data.brand.toUpperCase(), left, y);
    ctx.letterSpacing = '0px';
    y += 20;
  }

  // Nom (2 lignes max)
  ctx.fillStyle = COLORS.ink;
  const nameSize = format === 'square' ? 46 : 54;
  ctx.font = `500 ${nameSize}px ${SERIF}`;
  // La marque est déjà affichée au-dessus : on la retire du début du nom (« LOUIS VUITTON Speedy » → « Speedy »).
  let displayName = data.name.trim();
  if (data.brand && displayName.toUpperCase().startsWith(data.brand.toUpperCase() + ' ')) {
    displayName = displayName.slice(data.brand.length).trim();
  }
  const nameLines = wrapText(ctx, displayName, right - left, 2);
  for (const line of nameLines) {
    y += nameSize * 1.15;
    ctx.fillText(line, left, y);
  }
  y += 36;

  // Ligne état + prix
  const rowY = y;
  let px = left;
  if (data.condition) px += pill(ctx, data.condition.toUpperCase(), px, rowY, { size: 24 }) + 14;

  if (data.price != null) {
    ctx.textAlign = 'right';
    ctx.fillStyle = COLORS.ink;
    ctx.font = `700 ${format === 'square' ? 60 : 72}px ${SANS}`;
    const priceBaseline = rowY + 44;
    ctx.fillText(euro(data.price), right, priceBaseline + 8);
    const priceW = ctx.measureText(euro(data.price)).width;
    if (data.originalPrice && data.originalPrice > data.price) {
      // Remise en pastille, puis ancien prix barré : à gauche du prix s'il reste
      // la place, sinon juste au-dessus (format carré, prix longs).
      ctx.textAlign = 'left';
      const pct = Math.round((1 - data.price / data.originalPrice) * 100);
      if (pct > 0) px += pill(ctx, `-${pct} %`, px, rowY, { filled: true, size: 24, color: COLORS.sale }) + 14;
      ctx.textAlign = 'right';
      ctx.font = `500 32px ${SANS}`;
      ctx.fillStyle = COLORS.muted;
      const old = euro(data.originalPrice);
      const oldW = ctx.measureText(old).width;
      const inline = px + oldW + 22 + priceW <= right;
      const oldRight = inline ? right - priceW - 22 : right;
      const oldBaseline = inline ? priceBaseline : rowY - 14;
      ctx.fillText(old, oldRight, oldBaseline);
      ctx.fillRect(oldRight - oldW, oldBaseline - 11, oldW, 2.5);
    }
    ctx.textAlign = 'left';
  }

  // Pied : séparateur + domaine
  const fy = h - footer + (format === 'story' ? 50 : 24);
  ctx.fillStyle = COLORS.line;
  ctx.fillRect(M, fy, w - M * 2, 2);
  ctx.textAlign = 'center';
  ctx.fillStyle = COLORS.ink;
  ctx.font = `600 26px ${SANS}`;
  ctx.letterSpacing = '4px';
  ctx.fillText('B2B.OZEPARIS.COM', w / 2, fy + 52);
  ctx.letterSpacing = '0px';
  ctx.fillStyle = COLORS.muted;
  ctx.font = `400 22px ${SANS}`;
  ctx.fillText('Luxe de seconde main · Réservé aux revendeurs et boutiques', w / 2, fy + 90);
  ctx.textAlign = 'left';
}
