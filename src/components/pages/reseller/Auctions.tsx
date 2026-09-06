import React, { useState } from 'react';
import { AlertCircle, ImageOff, Gavel, Trophy, TrendingDown, ChevronUp, ChevronDown } from 'lucide-react';
import { Card, CardContent } from '../../ui/Card';
import { Badge } from '../../ui/Badge';
import { useResellerAuth } from '../../../hooks/useResellerAuth';
import { useAuctionItems, AuctionItem, QUICK_BID_INCREMENTS } from '../../../hooks/useAuctionItems';
import { AuctionCountdown } from './AuctionCountdown';
import { AuctionItemDetailModal } from './AuctionItemDetailModal';

const EUR = (n: number) => (Number(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';

interface ItemCardProps {
  item: AuctionItem;
  isWinning: boolean;
  isOutbid: boolean;
  myMax?: number;
  onOpen: () => void;
  onBid: (maxAmount: number) => Promise<{ success: boolean; error?: string; warning?: string }>;
}

/** Carte cliquable (ouvre la fiche détail, voir onOpen) qui permet AUSSI
 * d'enchérir directement sans l'ouvrir — les contrôles d'enchère stoppent
 * la propagation du clic pour ne pas déclencher onOpen en même temps.
 * Enchère automatique (proxy bidding, 0108) : le champ libre fixe un
 * plafond, pas une mise ponctuelle — le système surenchérit seul jusque-là. */
const ItemCard: React.FC<ItemCardProps> = ({ item, isWinning, isOutbid, myMax, onOpen, onBid }) => {
  const [customAmount, setCustomAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const ended = new Date(item.ends_at).getTime() <= Date.now() || item.status !== 'active';
  const nextMinBid = item.current_price + item.min_increment;

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
    e.stopPropagation();
    const parsed = Number(customAmount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError('Montant invalide');
      return;
    }
    submitBid(parsed);
  };

  return (
    <Card hover onClick={onOpen} className="overflow-hidden flex flex-col cursor-pointer">
      <div className="relative h-56 bg-gray-100 flex items-center justify-center overflow-hidden">
        {item.images?.[0] ? (
          <img src={item.images[0]} alt={item.title} className="w-full h-full object-cover" />
        ) : (
          <ImageOff className="h-10 w-10 text-gray-300" />
        )}
        <div className="absolute top-2 right-2">
          <Badge variant="info">{item.grade}</Badge>
        </div>
      </div>

      <CardContent className="p-4 flex-1 flex flex-col">
        {item.brand && <p className="text-xs font-medium text-gray-500">{item.brand}</p>}
        <p className="text-sm font-semibold text-gray-900 mt-0.5 line-clamp-2">{item.title}</p>

        <div className="flex items-center justify-between mt-3">
          <div>
            <p className="text-xs text-gray-400">Prix actuel</p>
            <p className="text-lg font-bold text-gray-900">{EUR(item.current_price)}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-400">Temps restant</p>
            <AuctionCountdown endsAt={item.ends_at} />
          </div>
        </div>

        {isWinning && (
          <div className="flex items-center gap-1.5 mt-2 text-green-700 bg-green-50 border border-green-100 rounded-lg px-2.5 py-1.5 text-xs font-medium">
            <Trophy className="h-3.5 w-3.5 flex-shrink-0" />
            <span>Vous menez l'enchère{myMax ? ` (votre plafond : ${EUR(myMax)})` : ''}</span>
          </div>
        )}
        {!isWinning && isOutbid && (
          <div className="flex items-center gap-1.5 mt-2 text-red-700 bg-red-50 border border-red-100 rounded-lg px-2.5 py-1.5 text-xs font-medium">
            <TrendingDown className="h-3.5 w-3.5 flex-shrink-0" />
            <span>Surenchéri{myMax ? ` (votre plafond : ${EUR(myMax)})` : ''}</span>
          </div>
        )}

        {item.status !== 'active' ? (
          <div className="mt-auto pt-3">
            <Badge variant={item.status === 'sold' ? 'success' : 'default'}>
              {item.status === 'sold' ? 'Vendu' : 'Invendu'}
            </Badge>
          </div>
        ) : ended ? (
          <div className="mt-auto pt-3">
            <Badge variant="default">Enchère terminée</Badge>
          </div>
        ) : (
          <div className="mt-auto pt-3 space-y-2" onClick={(e) => e.stopPropagation()}>
            <div className="grid grid-cols-3 gap-1.5">
              {QUICK_BID_INCREMENTS.map((inc) => (
                <button
                  key={inc}
                  onClick={() => submitBid(item.current_price + inc)}
                  disabled={submitting || inc < item.min_increment}
                  title={inc < item.min_increment ? `Pas minimal : ${EUR(item.min_increment)}` : undefined}
                  className="px-2 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed text-sm font-medium"
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
                    className="flex-1 px-2 flex items-center justify-center hover:bg-gray-100 border-b border-gray-200"
                    aria-label="Augmenter"
                  >
                    <ChevronUp className="h-4 w-4 text-gray-600" />
                  </button>
                  <button
                    type="button"
                    onClick={() => adjustAmount(-item.min_increment)}
                    className="flex-1 px-2 flex items-center justify-center hover:bg-gray-100"
                    aria-label="Diminuer"
                  >
                    <ChevronDown className="h-4 w-4 text-gray-600" />
                  </button>
                </div>
              </div>
              <button
                type="submit"
                disabled={submitting || !customAmount}
                className="px-3 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50 text-sm font-medium flex-shrink-0"
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
      </CardContent>
    </Card>
  );
};

/** Page "mode sous-marin" des enchères en direct — accessible uniquement
 * via le cadenas discret de la nav (voir ResellerApp.tsx / useAuctionAccess),
 * jamais listée dans le menu. Charte graphique alignée sur le reste du
 * portail (Card/Badge partagés, boutons sombres). */
export const Auctions: React.FC = () => {
  const { profile } = useResellerAuth();
  const { session, items, myBidItemIds, myMaxAmounts, loading, error, placeAutoBid } = useAuctionItems(true, profile?.id);
  const [viewingItemId, setViewingItemId] = useState<string | null>(null);
  const viewingItem = items.find((i) => i.id === viewingItemId) || null;

  return (
    <div className="p-4 md:p-6">
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <Gavel className="h-5 w-5" />
          {session?.title || 'Enchères en direct'}
        </h3>
        <p className="text-sm text-gray-500">
          {session ? (
            <>
              {session.status === 'live' ? 'En direct maintenant' : 'À venir'} — du{' '}
              {new Date(session.starts_at).toLocaleString('fr-FR', { day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit' })} au{' '}
              {new Date(session.ends_at).toLocaleString('fr-FR', { day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit' })}
            </>
          ) : (
            'Session hebdomadaire réservée aux revendeurs invités'
          )}
        </p>
      </div>

      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-3">
          <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0" />
          <p className="text-sm text-red-700">Erreur : {error}</p>
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => <div key={i} className="h-96 bg-gray-100 rounded-lg animate-pulse" />)}
        </div>
      ) : !session ? (
        <div className="text-center py-16 border border-dashed border-gray-200 rounded-lg">
          <Gavel className="h-10 w-10 text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-500">Aucune session d'enchères active pour le moment.</p>
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-gray-200 rounded-lg">
          <Gavel className="h-10 w-10 text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-500">Aucune pièce n'a encore été ajoutée à cette session.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map((item) => (
            <ItemCard
              key={item.id}
              item={item}
              isWinning={Boolean(profile?.id) && item.current_winner_id === profile?.id}
              isOutbid={myBidItemIds.has(item.id) && item.current_winner_id !== profile?.id}
              myMax={myMaxAmounts.get(item.id)}
              onOpen={() => setViewingItemId(item.id)}
              onBid={(maxAmount) => placeAutoBid(item.id, maxAmount)}
            />
          ))}
        </div>
      )}

      <AuctionItemDetailModal
        item={viewingItem}
        isWinning={Boolean(profile?.id) && viewingItem?.current_winner_id === profile?.id}
        isOutbid={Boolean(viewingItem) && myBidItemIds.has(viewingItem!.id) && viewingItem?.current_winner_id !== profile?.id}
        myMax={viewingItem ? myMaxAmounts.get(viewingItem.id) : undefined}
        onClose={() => setViewingItemId(null)}
        onBid={(maxAmount) => (viewingItem ? placeAutoBid(viewingItem.id, maxAmount) : Promise.resolve({ success: false, error: 'Pièce inconnue' }))}
      />
    </div>
  );
};

export default Auctions;
