import React from 'react';
import { ImageOff } from 'lucide-react';
import { B2BCartItem } from '../../../hooks/useB2BCart';
import { DeliveryType } from './ShippingForm';

interface CheckoutSummaryProps {
  items: B2BCartItem[];
  subtotal: number;
  shipping: number;
  total: number;
  deliveryType: DeliveryType;
}

// Adapté de oze-storefront/CheckoutSummary.tsx : pas de code promo côté B2B
// (aucun système de coupon pour les revendeurs), sinon même structure
// (articles, sous-total, livraison, total).
const CheckoutSummary: React.FC<CheckoutSummaryProps> = ({ items, subtotal, shipping, total, deliveryType }) => {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-4">
      <h4 className="text-sm font-semibold text-gray-900">Récapitulatif</h4>

      <ul className="space-y-3">
        {items.map((item) => (
          <li key={item.id} className="flex gap-3">
            <div className="h-14 w-14 bg-gray-100 rounded flex items-center justify-center flex-shrink-0 overflow-hidden">
              {item.image ? (
                <img src={item.image} alt={item.name} className="w-full h-full object-cover" />
              ) : (
                <ImageOff className="h-4 w-4 text-gray-300" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">{item.name}</p>
              <p className="text-xs text-gray-400">{item.product_code}</p>
              <p className="text-sm text-gray-700 mt-0.5">{item.price.toFixed(0)} €</p>
            </div>
          </li>
        ))}
      </ul>

      <div className="border-t border-gray-100 pt-3 space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-500">Sous-total</span>
          <span className="text-gray-900">{subtotal.toFixed(2)} €</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-500">
            Livraison
            <span className="block text-xs text-gray-400">
              {deliveryType === 'point_relais' ? 'Point Relais' : "Livraison à l'entreprise"}
            </span>
          </span>
          <span className="text-gray-900">{shipping.toFixed(2)} €</span>
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
