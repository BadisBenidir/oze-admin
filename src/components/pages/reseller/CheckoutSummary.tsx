import React from 'react';
import { DeliveryType } from './ShippingForm';

interface CheckoutSummaryProps {
  subtotal: number;
  shipping: number;
  insurance: number;
  total: number;
  deliveryType: DeliveryType;
  grouped?: boolean;
  discountRate?: number;
  discountAmount?: number;
  promoCode?: string | null;
  promoDiscountAmount?: number;
}

// Adapté de oze-storefront/CheckoutSummary.tsx : la liste des articles vit
// désormais directement dans CartPage (avec la case à cocher assurance par
// article) pour ne pas la dupliquer — ce composant ne porte plus que le
// détail chiffré (sous-total, remises, livraison, assurance, total).
const CheckoutSummary: React.FC<CheckoutSummaryProps> = ({
  subtotal,
  shipping,
  insurance,
  total,
  deliveryType,
  grouped,
  discountRate = 0,
  discountAmount = 0,
  promoCode = null,
  promoDiscountAmount = 0,
}) => {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-4">
      <h4 className="text-sm font-semibold text-gray-900">Récapitulatif</h4>

      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-500">Sous-total</span>
          <span className="text-gray-900">{subtotal.toFixed(2)} €</span>
        </div>
        {discountAmount > 0 && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-400 flex items-center gap-1.5">
              Remise Volume B2B
              <span className="text-[11px] font-medium text-gray-500 bg-gray-100 rounded-full px-1.5 py-0.5">
                -{discountRate * 100}%
              </span>
            </span>
            <span className="text-gray-400">-{discountAmount.toFixed(2)} €</span>
          </div>
        )}
        {promoDiscountAmount > 0 && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-400">Remise ({promoCode})</span>
            <span className="text-gray-400">-{promoDiscountAmount.toFixed(2)} €</span>
          </div>
        )}
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-500">
            Livraison
            <span className="block text-xs text-gray-400">
              {grouped ? 'Groupée avec une commande existante' : deliveryType === 'point_relais' ? 'Point Relais' : "Livraison à l'entreprise"}
            </span>
          </span>
          <span className={grouped ? 'text-green-600 font-medium' : 'text-gray-900'}>
            {grouped ? 'Gratuite' : `${shipping.toFixed(2)} €`}
          </span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-500">Assurance colis</span>
          <span className="text-gray-900">{insurance.toFixed(2)} €</span>
        </div>
        <div className="flex items-center justify-between border-t border-gray-100 pt-2">
          <span className="text-sm font-medium text-gray-700">Total</span>
          <span className="text-lg font-semibold text-gray-900">{total.toFixed(2)} €</span>
        </div>
      </div>
    </div>
  );
};

export default CheckoutSummary;
