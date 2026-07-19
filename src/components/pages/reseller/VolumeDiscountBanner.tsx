import React from 'react';
import { getVolumeDiscountInfo } from '../../../utils/volumeDiscount';

interface VolumeDiscountBannerProps {
  itemCount: number;
}

const MAX_TIER_ITEMS = 10;

/**
 * Jauge de remise dégressive B2B, juste au-dessus de la liste d'articles du
 * panier/checkout. Purement informatif — le tarif réellement facturé est
 * toujours recalculé côté serveur (voir b2b-checkout).
 */
export const VolumeDiscountBanner: React.FC<VolumeDiscountBannerProps> = ({ itemCount }) => {
  const { rate, nextTierAt, nextTierRate } = getVolumeDiscountInfo(itemCount);
  const progress = Math.min(itemCount, MAX_TIER_ITEMS) / MAX_TIER_ITEMS * 100;
  const remaining = nextTierAt !== null ? nextTierAt - itemCount : 0;

  const message =
    nextTierAt === null
      ? 'Félicitations, vous bénéficiez de -10% sur votre lot (remise maximale).'
      : rate > 0
      ? `Vous bénéficiez de -${rate * 100}% sur votre lot. Plus que ${remaining} article${remaining > 1 ? 's' : ''} pour débloquer -${nextTierRate! * 100}%.`
      : `Plus que ${remaining} article${remaining > 1 ? 's' : ''} pour débloquer -${nextTierRate! * 100}% de remise.`;

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-medium text-gray-900">Remise volume</p>
        {rate > 0 && (
          <span className="text-xs font-semibold text-white bg-gray-900 rounded-full px-2.5 py-1">
            -{rate * 100}%
          </span>
        )}
      </div>

      <div className="relative h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div
          className="absolute inset-y-0 left-0 bg-gray-900 rounded-full transition-all duration-500 ease-out"
          style={{ width: `${progress}%` }}
        />
        {/* Repère du palier intermédiaire (5 articles). */}
        <div className="absolute inset-y-0 left-1/2 w-px bg-white/70" />
      </div>
      <div className="flex items-center justify-between text-[11px] text-gray-400 mt-1.5 mb-3">
        <span>0</span>
        <span>5 art. · -5%</span>
        <span>10 art. · -10%</span>
      </div>

      <p className="text-sm text-gray-600">{message}</p>
    </div>
  );
};
