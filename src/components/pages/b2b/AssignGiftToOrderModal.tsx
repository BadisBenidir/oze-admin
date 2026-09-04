import React, { useEffect, useMemo, useState } from 'react';
import { X, AlertCircle, Search, Package } from 'lucide-react';
import { supabase } from '../../../lib/supabase';

interface OrderOption {
  id: string;
  order_number: string;
  status: string;
  created_at: string;
  total_amount: number;
}

interface AssignGiftToOrderModalProps {
  isOpen: boolean;
  resellerId: string | null;
  onClose: () => void;
  onAssign: (orderId: string) => Promise<{ success: boolean; error?: string }>;
}

/** Assigne manuellement un portefeuille offert dû à une commande B2B en
 * cours de préparation du même revendeur — voir 0101_b2b_gift_rewards.sql.
 * Liste ses commandes non annulées (les plus récentes en premier), pas
 * seulement celles "en préparation" au sens strict : l'admin sait mieux que
 * nous laquelle est réellement en cours d'emballage. */
export const AssignGiftToOrderModal: React.FC<AssignGiftToOrderModalProps> = ({ isOpen, resellerId, onClose, onAssign }) => {
  const [orders, setOrders] = useState<OrderOption[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen || !resellerId) return;
    setSearch('');
    setSelectedId(null);
    setError('');
    let mounted = true;

    const load = async () => {
      setLoadingOrders(true);
      setLoadError('');
      try {
        const { data, error: fetchError } = await supabase
          .from('orders')
          .select('id, order_number, status, created_at, total_amount')
          .eq('reseller_id', resellerId)
          .eq('order_channel', 'b2b')
          .neq('status', 'cancelled')
          .order('created_at', { ascending: false });
        if (fetchError) throw new Error(fetchError.message);
        if (mounted) setOrders((data || []) as OrderOption[]);
      } catch (err) {
        if (mounted) setLoadError(err instanceof Error ? err.message : 'Erreur de chargement des commandes');
      } finally {
        if (mounted) setLoadingOrders(false);
      }
    };

    load();
    return () => {
      mounted = false;
    };
  }, [isOpen, resellerId]);

  const filteredOrders = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return orders;
    return orders.filter((o) => o.order_number.toLowerCase().includes(term));
  }, [orders, search]);

  const handleClose = () => onClose();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedId) {
      setError('Sélectionne une commande');
      return;
    }
    setSubmitting(true);
    setError('');
    const result = await onAssign(selectedId);
    setSubmitting(false);
    if (!result.success) {
      setError(result.error || "Erreur lors de l'assignation");
      return;
    }
    handleClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto">
      <div className="fixed inset-0 bg-black bg-opacity-25" onClick={handleClose} />
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between p-5 border-b border-gray-100 flex-shrink-0">
            <h3 className="text-base font-semibold text-gray-900">Assigner à une commande</h3>
            <button onClick={handleClose} className="p-1 text-gray-400 hover:text-gray-600 rounded-lg transition-colors">
              <X className="h-5 w-5" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
            <div className="p-5 space-y-3 overflow-y-auto flex-1">
              <p className="text-xs text-gray-500">
                Le portefeuille sera inclus dans le colis de la commande choisie — pense à l'y ajouter physiquement.
              </p>

              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Filtrer par numéro de commande..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-gray-400 text-sm"
                />
              </div>

              {loadError && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-center space-x-2">
                  <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0" />
                  <p className="text-sm text-red-700">{loadError}</p>
                </div>
              )}

              <div className="border border-gray-200 rounded-lg max-h-72 overflow-y-auto divide-y divide-gray-100">
                {loadingOrders ? (
                  [...Array(3)].map((_, i) => (
                    <div key={i} className="p-3">
                      <div className="h-10 bg-gray-100 rounded-lg animate-pulse" />
                    </div>
                  ))
                ) : filteredOrders.length === 0 ? (
                  <div className="p-6 text-center text-sm text-gray-500">
                    {orders.length === 0 ? 'Aucune commande active pour ce revendeur.' : 'Aucun résultat pour cette recherche.'}
                  </div>
                ) : (
                  filteredOrders.map((order) => (
                    <label
                      key={order.id}
                      className={`flex items-center gap-3 p-3 cursor-pointer transition-colors ${selectedId === order.id ? 'bg-gray-900/5' : 'hover:bg-gray-50'}`}
                    >
                      <input
                        type="radio"
                        name="assign-order"
                        checked={selectedId === order.id}
                        onChange={() => setSelectedId(order.id)}
                        className="h-4 w-4 border-gray-300 text-gray-900 focus:ring-gray-900 flex-shrink-0"
                      />
                      <div className="h-9 w-9 bg-gray-100 rounded-lg flex items-center justify-center flex-shrink-0">
                        <Package className="h-4 w-4 text-gray-400" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-900 truncate">#{order.order_number}</p>
                        <p className="text-xs text-gray-500">
                          {new Date(order.created_at).toLocaleDateString('fr-FR')} · {order.total_amount.toFixed(0)} €
                        </p>
                      </div>
                    </label>
                  ))
                )}
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-center space-x-2">
                  <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0" />
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              )}
            </div>

            <div className="flex justify-end space-x-3 p-5 pt-4 border-t border-gray-100 flex-shrink-0">
              <button type="button" onClick={handleClose} className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors text-sm">
                Annuler
              </button>
              <button
                type="submit"
                disabled={submitting || !selectedId}
                className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50 text-sm font-medium"
              >
                {submitting ? 'Assignation...' : 'Assigner'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default AssignGiftToOrderModal;
