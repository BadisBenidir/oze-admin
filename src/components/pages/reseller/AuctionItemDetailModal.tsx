import React, { useEffect, useState } from 'react';
import { X, ChevronLeft, ChevronRight, ImageOff, AlertCircle, Trophy, TrendingDown, ChevronUp, ChevronDown } from 'lucide-react';
import { Badge } from '../../ui/Badge';
import { AuctionItem, QUICK_BID_INCREMENTS } from '../../../hooks/useAuctionItems';
import { AuctionCountdown } from './AuctionCountdown';

const EUR = (n: number) => (Number(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';

interface AuctionItemDetailModalProps {
  item: AuctionItem | null;
  isWinning: boolean;
  isOutbid: boolean;
  myMax?: number;
  /** false tant que le statut juridique du revendeur n'est pas renseigné
   * (voir Auctions.tsx) — place_auto_bid (0109) le refuserait de toute
   * façon côté serveur, ce n'est qu'un confort d'affichage ici. */
  canBid: boolean;
  onClose: () => void;
  onBid: (maxAmount: number) => Promise<{ success: boolean; error?: string; warning?: string }>;
}

/** Fiche détail d'un lot d'enchère — galerie photo façon fiche produit du
 * catalogue (voir SourcingItemDetailModal.tsx pour le même motif de
 * carrousel), avec l'enchère directement disponible ici plutôt que sur la
 * carte de la grille. Enchère automatique (proxy bidding, 0108) : le champ
 * libre fixe un plafond, pas une mise ponctuelle. */
export const AuctionItemDetailModal: React.FC<AuctionItemDetailModalProps> = ({ item, isWinning, isOutbid, myMax, canBid, onClose, onBid }) => {
  const [activeIndex, setActiveIndex] = useState(0);
  const [customAmount, setCustomAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');

  useEffect(() => {
    setActiveIndex(0);
    setCustomAmount('');
    setError('');
    setWarning('');
  }, [item?.id]);

  if (!item) return null;

  const images = item.images || [];
  const ended = new Date(item.ends_at).getTime() <= Date.now() || item.status !== 'active';
  const nextMinBid = item.current_price + item.min_increment;

  const goPrev = () => setActiveIndex((i) => (i - 1 + images.length) % images.length);
  const goNext = () => setActiveIndex((i) => (i + 1) % images.length);

  const submitBid = async (maxAmount: number) => {
    if (submitting || ended) return;
    setSubmitting(true);
    setError('');
    setWarning('');
    const result = await onBid(maxAmount);
    setSubmitting(false);
    if (!result.success) {
      setError(result.error || "Erreur lors de l'enchère");
      return;
    }
    if (result.warning) setWarning(result.warning);
    setCustomAmount('');
  };

  const adjustAmount = (delta: number) => {
    const current = customAmount === '' ? nextMinBid - item.min_increment : Number(customAmount);
    const base = Number.isFinite(current) ? current : nextMinBid - item.min_increment;
    const next = Math.max(nextMinBid, base + delta);
    setCustomAmount(String(Number(next.toFixed(2))));
  };

  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = Number(customAmount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError('Montant invalide');
      return;
    }
    submitBid(parsed);
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black bg-opacity-50" onClick={onClose} />
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
          <button onClick={onClose} className="absolute top-4 right-4 p-1.5 text-gray-500 hover:text-gray-900 bg-white/90 rounded-full shadow z-10 transition-colors">
            <X className="h-5 w-5" />
          </button>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 p-6">
            {/* Galerie */}
            <div>
              <div className="bg-gray-100 rounded-lg overflow-hidden">
                <div className="relative h-72 md:h-96 flex items-center justify-center">
                  {images.length > 0 ? (
                    <img src={images[activeIndex]} alt={item.title} className="w-full h-full object-cover" />
                  ) : (
                    <ImageOff className="h-12 w-12 text-gray-300" />
                  )}
                  {images.length > 1 && (
                    <>
                      <button onClick={goPrev} className="absolute left-2 top-1/2 -translate-y-1/2 p-1.5 bg-white/90 rounded-full text-gray-700 hover:bg-white shadow">
                        <ChevronLeft className="h-4 w-4" />
                      </button>
                      <button onClick={goNext} className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 bg-white/90 rounded-full text-gray-700 hover:bg-white shadow">
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </>
                  )}
                </div>
                {images.length > 1 && (
                  <div className="flex gap-2 p-3 overflow-x-auto">
                    {images.map((img, i) => (
                      <button
                        key={i}
                        onClick={() => setActiveIndex(i)}
                        className={`h-16 w-16 flex-shrink-0 rounded-md overflow-hidden border-2 transition-colors ${
                          i === activeIndex ? 'border-gray-900' : 'border-transparent'
                        }`}
                      >
                        <img src={img} alt="" className="w-full h-full object-cover" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Informations + enchère */}
            <div>
              {item.brand && <p className="text-sm font-medium text-gray-500">{item.brand}</p>}
              <h2 className="text-xl font-semibold text-gray-900 mt-0.5">{item.title}</h2>
              <div className="mt-3">
                <Badge variant="info">{item.grade}</Badge>
              </div>

              {(item.material || (item.colors && item.colors.length > 0) || item.serial_number) && (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {item.material && (
                    <span className="text-xs text-gray-600 bg-gray-100 rounded-full px-2.5 py-1 capitalize">
                      <span className="text-gray-400">Matière :</span> {item.material}
                    </span>
                  )}
                  {item.colors && item.colors.length > 0 && (
                    <span className="text-xs text-gray-600 bg-gray-100 rounded-full px-2.5 py-1 capitalize">
                      <span className="text-gray-400">Couleur :</span> {item.colors.join(', ')}
                    </span>
                  )}
                  {item.serial_number && (
                    <span className="text-xs text-gray-600 bg-gray-100 rounded-full px-2.5 py-1 font-mono">
                      <span className="text-gray-400 font-sans">N° série :</span> {item.serial_number}
                    </span>
                  )}
                </div>
              )}

              {item.description && (
                <div className="mt-3">
                  <p className="text-sm font-medium text-gray-700 mb-1">Description</p>
                  <p className="text-sm text-gray-600 whitespace-pre-line">{item.description}</p>
                </div>
              )}

              <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-100">
                <div>
                  <p className="text-xs text-gray-400">Prix actuel</p>
                  <p className="text-2xl font-bold text-gray-900">{EUR(item.current_price)}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-gray-400">Temps restant</p>
                  <AuctionCountdown endsAt={item.ends_at} className="text-base" />
                </div>
              </div>

              {isWinning && (
                <div className="flex items-center gap-1.5 mt-3 text-green-700 bg-green-50 border border-green-100 rounded-lg px-2.5 py-1.5 text-sm font-medium">
                  <Trophy className="h-4 w-4 flex-shrink-0" />
                  <span>Vous menez l'enchère{myMax ? ` (votre plafond : ${EUR(myMax)})` : ''}</span>
                </div>
              )}
              {!isWinning && isOutbid && (
                <div className="flex items-center gap-1.5 mt-3 text-red-700 bg-red-50 border border-red-100 rounded-lg px-2.5 py-1.5 text-sm font-medium">
                  <TrendingDown className="h-4 w-4 flex-shrink-0" />
                  <span>Surenchéri{myMax ? ` (votre plafond : ${EUR(myMax)})` : ''}</span>
                </div>
              )}

              {item.status !== 'active' ? (
                <div className="mt-4">
                  <Badge variant={item.status === 'sold' ? 'success' : 'default'}>
                    {item.status === 'sold' ? 'Vendu' : 'Invendu'}
                  </Badge>
                </div>
              ) : ended ? (
                <div className="mt-4">
                  <Badge variant="default">Enchère terminée</Badge>
                </div>
              ) : !canBid ? (
                <p className="mt-4 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
                  Statut juridique requis pour enchérir — complétez "Mon profil" pour poursuivre.
                </p>
              ) : (
                <div className="mt-4 space-y-2">
                  <div className="grid grid-cols-3 gap-2">
                    {QUICK_BID_INCREMENTS.map((inc) => (
                      <button
                        key={inc}
                        onClick={() => submitBid(item.current_price + inc)}
                        disabled={submitting || inc < item.min_increment}
                        title={inc < item.min_increment ? `Pas minimal : ${EUR(item.min_increment)}` : undefined}
                        className="px-3 py-3 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed text-sm font-medium"
                      >
                        +{inc} €
                      </button>
                    ))}
                  </div>
                  <form onSubmit={handleCustomSubmit} className="flex gap-2">
                    <div className="flex-1 min-w-0 flex items-stretch border border-gray-200 rounded-lg overflow-hidden focus-within:border-gray-400">
                      <input
                        type="number"
                        step={item.min_increment}
                        min={nextMinBid}
                        value={customAmount}
                        onChange={(e) => setCustomAmount(e.target.value)}
                        placeholder="Votre offre max (ex: 100 €)"
                        className="flex-1 min-w-0 px-3 py-2 text-sm focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                      <div className="flex flex-col border-l border-gray-200">
                        <button
                          type="button"
                          onClick={() => adjustAmount(item.min_increment)}
                          className="flex-1 px-2.5 flex items-center justify-center hover:bg-gray-100 border-b border-gray-200"
                          aria-label="Augmenter"
                        >
                          <ChevronUp className="h-4 w-4 text-gray-600" />
                        </button>
                        <button
                          type="button"
                          onClick={() => adjustAmount(-item.min_increment)}
                          className="flex-1 px-2.5 flex items-center justify-center hover:bg-gray-100"
                          aria-label="Diminuer"
                        >
                          <ChevronDown className="h-4 w-4 text-gray-600" />
                        </button>
                      </div>
                    </div>
                    <button
                      type="submit"
                      disabled={submitting || !customAmount}
                      className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50 text-sm font-medium flex-shrink-0"
                    >
                      Définir max
                    </button>
                  </form>
                  <p className="text-[11px] text-gray-400 leading-snug">
                    Enchère automatique : nous surenchérirons du pas minimal requis uniquement si nécessaire, jusqu'à votre plafond.
                  </p>
                  {error && (
                    <div className="flex items-center gap-1.5 text-red-600 text-xs">
                      <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                      <span>{error}</span>
                    </div>
                  )}
                  {!error && warning && (
                    <div className="flex items-center gap-1.5 text-amber-600 text-xs">
                      <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                      <span>{warning}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AuctionItemDetailModal;
