import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Download, Share2, X } from 'lucide-react';
import logoUrl from '../landing/assets/logo_oze_paris_b2b.png';
import { FORMATS, drawPoster, euro, loadImage, type Format } from './productPoster';

/**
 * Affiche promotionnelle d'un article (image PNG à partager sur Instagram,
 * WhatsApp, Discord…) : photo principale, marque, nom, état, prix et logo
 * OZË B2B. Entièrement dessinée dans le navigateur (canvas), sans service
 * externe. Les photos produits (stockage Supabase public) sont chargées en
 * CORS anonyme pour que le canvas reste exportable.
 */

interface ProductPosterModalProps {
  name: string;
  brand?: string | null;
  conditionLabel?: string | null;
  price: number;
  originalPrice?: number | null;
  imageUrl?: string | null;
  reference?: string | null;
  onClose: () => void;
}

export const ProductPosterModal: React.FC<ProductPosterModalProps> = ({
  name, brand, conditionLabel, price, originalPrice, imageUrl, reference, onClose,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [format, setFormat] = useState<Format>('post');
  const [showPrice, setShowPrice] = useState(true);
  const [priceInput, setPriceInput] = useState(String(price ?? ''));
  const [images, setImages] = useState<{ image: HTMLImageElement | null; logo: HTMLImageElement | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  // Chargement unique de la photo et du logo
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      imageUrl ? loadImage(imageUrl).catch(() => null) : Promise.resolve(null),
      loadImage(logoUrl).catch(() => null),
    ]).then(([image, logo]) => {
      if (cancelled) return;
      if (imageUrl && !image) setError('La photo principale n\'a pas pu être chargée : l\'affiche est générée sans photo.');
      setImages({ image, logo });
    });
    return () => {
      cancelled = true;
    };
  }, [imageUrl]);

  const parsedPrice = useMemo(() => {
    const n = Number(priceInput.replace(',', '.'));
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [priceInput]);

  // Redessin à chaque changement d'option
  useEffect(() => {
    if (!images || !canvasRef.current) return;
    drawPoster(canvasRef.current, format, {
      name,
      brand,
      condition: conditionLabel,
      price: showPrice ? parsedPrice : null,
      originalPrice: showPrice ? originalPrice : null,
      image: images.image,
      logo: images.logo,
    }).then(() => {
      try {
        setPreview(canvasRef.current!.toDataURL('image/png'));
      } catch {
        setError('Impossible d\'exporter l\'image (photo protégée par CORS).');
      }
    });
  }, [images, format, showPrice, parsedPrice, name, brand, conditionLabel, originalPrice]);

  const fileName = `oze-${(reference || name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${format}.png`;

  const [notice, setNotice] = useState<string | null>(null);

  // Tout se fait de façon synchrone à partir de l'aperçu déjà généré (data
  // URL) : un `await` avant share()/click() fait perdre au navigateur le
  // "geste utilisateur", et le partage (voire le téléchargement) est alors
  // refusé sans rien afficher.
  const previewFile = (): File | null => {
    if (!preview) return null;
    const bytes = atob(preview.split(',')[1]);
    const buffer = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) buffer[i] = bytes.charCodeAt(i);
    return new File([buffer], fileName, { type: 'image/png' });
  };

  const download = () => {
    if (!preview) return;
    const a = document.createElement('a');
    a.href = preview;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const share = () => {
    const file = previewFile();
    if (!file) return;
    setNotice(null);
    if (!navigator.canShare?.({ files: [file] })) {
      download();
      setNotice('Partage d\'image non pris en charge par ce navigateur : l\'affiche a été téléchargée.');
      return;
    }
    navigator.share({ files: [file], title: name }).catch((err: unknown) => {
      if (err instanceof DOMException && err.name === 'AbortError') return; // partage annulé
      download();
      setNotice('Le partage a échoué : l\'affiche a été téléchargée à la place.');
    });
  };

  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative w-full max-w-4xl rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between border-b border-gray-100 p-5">
            <h3 className="text-base font-semibold text-gray-900">Affiche de l'article</h3>
            <button onClick={onClose} className="rounded-lg p-1 text-gray-400 transition-colors hover:text-gray-600">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="grid grid-cols-1 gap-6 p-5 md:grid-cols-[1fr_280px]">
            {/* Aperçu */}
            <div className="flex items-center justify-center rounded-lg bg-gray-100 p-4">
              <canvas ref={canvasRef} className="hidden" />
              {preview ? (
                <img src={preview} alt="Aperçu de l'affiche" className="max-h-[65vh] w-auto rounded-md shadow-md" />
              ) : (
                <div className="flex h-80 items-center justify-center text-sm text-gray-400">Préparation de l'affiche…</div>
              )}
            </div>

            {/* Options */}
            <div className="space-y-5">
              <div>
                <p className="mb-2 text-sm font-medium text-gray-700">Format</p>
                <div className="grid grid-cols-3 gap-1.5 rounded-lg bg-gray-100 p-1">
                  {(Object.keys(FORMATS) as Format[]).map((f) => (
                    <button
                      key={f}
                      onClick={() => setFormat(f)}
                      className={`rounded-md py-1.5 text-xs font-medium transition-colors ${
                        format === f ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'
                      }`}
                    >
                      {FORMATS[f].label}
                      <span className="block text-[10px] font-normal text-gray-400">{FORMATS[f].hint}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-700">
                  <input
                    type="checkbox"
                    checked={showPrice}
                    onChange={(e) => setShowPrice(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-gray-900"
                  />
                  Afficher le prix
                </label>
                {showPrice && (
                  <div className="relative">
                    <input
                      value={priceInput}
                      onChange={(e) => setPriceInput(e.target.value)}
                      inputMode="decimal"
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 pr-8 text-sm focus:border-gray-400 focus:outline-none"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">€</span>
                  </div>
                )}
                {showPrice && originalPrice && parsedPrice && originalPrice > parsedPrice && (
                  <p className="mt-1.5 text-xs text-gray-500">Ancien prix barré affiché : {euro(originalPrice)}</p>
                )}
              </div>

              {error && (
                <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" /> {error}
                </p>
              )}

              <div className="space-y-2 pt-1">
                <button
                  onClick={download}
                  disabled={!preview}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-gray-800 disabled:opacity-50"
                >
                  <Download className="h-4 w-4" /> Télécharger l'image
                </button>
                {canShare && (
                  <button
                    onClick={share}
                    disabled={!preview}
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-gray-100 px-4 py-2.5 text-sm font-medium text-gray-800 transition-colors hover:bg-gray-200 disabled:opacity-50"
                  >
                    <Share2 className="h-4 w-4" /> Partager
                  </button>
                )}
                {notice && <p className="text-center text-xs text-amber-700">{notice}</p>}
                <p className="text-center text-[11px] text-gray-400">PNG {FORMATS[format].w} × {FORMATS[format].h} px</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProductPosterModal;
