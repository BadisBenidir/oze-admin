import React, { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { CheckCircle2, ShoppingBag } from 'lucide-react';

interface CheckoutSuccessProps {
  sessionId: string | null;
  /** Paiement 100% solde : commande déjà connue immédiatement, pas de session Stripe ni de webhook à attendre. */
  orderId?: string | null;
  onGoToOrders: () => void;
}

interface OrderRecap {
  order_number: string;
  total_amount: number;
  order_items: { id: string }[];
}

export const CheckoutSuccess: React.FC<CheckoutSuccessProps> = ({ sessionId, orderId, onGoToOrders }) => {
  const [order, setOrder] = useState<OrderRecap | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!sessionId && !orderId) {
      setLoading(false);
      return;
    }

    let mounted = true;

    const fetchOrder = async () => {
      const query = supabase.from('orders').select('order_number, total_amount, order_items(id)');
      const { data } = orderId
        ? await query.eq('id', orderId).maybeSingle()
        : await query.eq('stripe_session_id', sessionId).maybeSingle();
      return data as OrderRecap | null;
    };

    (async () => {
      let data = await fetchOrder();
      // Le webhook Stripe peut mettre quelques secondes à traiter le paiement
      // après la redirection : un seul nouvel essai suffit dans la grande
      // majorité des cas, sans mettre en place un vrai polling. Non
      // applicable au paiement par solde (orderId déjà connu, créé
      // synchroniquement, pas de webhook à attendre).
      if (!data && mounted && !orderId) {
        await new Promise((resolve) => setTimeout(resolve, 2500));
        data = await fetchOrder();
      }
      if (mounted) {
        setOrder(data);
        setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [sessionId, orderId]);

  return (
    <div className="p-4 md:p-6 max-w-lg mx-auto">
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-8 text-center">
        <CheckCircle2 className="h-14 w-14 text-green-600 mx-auto mb-4" />
        <h2 className="text-lg font-semibold text-gray-900 mb-2">Paiement validé !</h2>
        <p className="text-sm text-gray-600 mb-6">Votre commande est en cours de préparation.</p>

        {loading ? (
          <div className="h-20 bg-gray-50 rounded-lg animate-pulse mb-6" />
        ) : order ? (
          <div className="bg-gray-50 rounded-lg p-4 mb-6 text-left space-y-1">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Commande</span>
              <span className="font-medium text-gray-900">{order.order_number}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Articles</span>
              <span className="font-medium text-gray-900">{order.order_items?.length ?? 0}</span>
            </div>
            <div className="flex justify-between text-base font-semibold border-t border-gray-200 pt-2 mt-2">
              <span className="text-gray-900">Total payé</span>
              <span className="text-gray-900">{order.total_amount.toFixed(0)} €</span>
            </div>
          </div>
        ) : (
          <p className="text-xs text-gray-400 mb-6">
            Le récapitulatif sera visible dans quelques instants dans « Mes commandes ».
          </p>
        )}

        <button
          onClick={onGoToOrders}
          className="inline-flex items-center space-x-2 px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors text-sm"
        >
          <ShoppingBag className="h-4 w-4" />
          <span>Voir mes commandes</span>
        </button>
      </div>
    </div>
  );
};
