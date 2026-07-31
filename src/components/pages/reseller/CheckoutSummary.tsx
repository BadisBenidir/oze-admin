import React from 'react';

interface CheckoutSummaryProps {
  subtotal: number;
  insurance: number;
  total: number;
  discountRate?: number;
  discountAmount?: number;
  promoCode?: string | null;
  promoDiscountAmount?: number;
}

// Adapté de oze-storefront/CheckoutSummary.tsx : la liste des articles vit
// désormais directement dans CartPage (avec la case à cocher assurance par
// article) pour ne pas la dupliquer — ce composant ne porte plus que le
// détail chiffré (sous-total, remises, assurance, total). Le mode/l'adresse
// de livraison n'étant plus choisis au checkout (voir CartPage), aucune
// commande n'est facturée de frais de port ici — la livraison n'est donc
// plus affichée qu'à titre indicatif, toujours gratuite.
const CheckoutSummary: React.FC<CheckoutSummaryProps> = ({
  subtotal,
  insurance,
  total,
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
            <span className="block text-xs text-gray-400">À organiser après paiement</span>
          </span>
          <span className="text-green-600 font-medium">Gratuite</span>
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
