import React, { useMemo, useState } from 'react';
import { Gift, AlertCircle, PackageCheck, PackageX, Send, X } from 'lucide-react';
import { Card, CardContent } from '../../ui/Card';
import { Badge } from '../../ui/Badge';
import { useAdminAuth } from '../../../hooks/useAdminAuth';
import { useGiftRewards, GiftReward } from '../../../hooks/useGiftRewards';
import { AssignGiftToOrderModal } from './AssignGiftToOrderModal';

type StatusFilter = 'all' | 'due' | 'shipped';

const statusBadge = (status: GiftReward['status']) => {
  switch (status) {
    case 'assigned':
      return <Badge variant="info">Inclus dans une commande</Badge>;
    case 'shipped':
      return <Badge variant="success">Envoyé</Badge>;
    default:
      return <Badge variant="warning">À envoyer</Badge>;
  }
};

interface MarkShippedModalProps {
  gift: GiftReward | null;
  onClose: () => void;
  onConfirm: (note: string) => Promise<{ success: boolean; error?: string }>;
}

const MarkShippedModal: React.FC<MarkShippedModalProps> = ({ gift, onClose, onConfirm }) => {
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  if (!gift) return null;

  const handleConfirm = async () => {
    setSubmitting(true);
    setError('');
    const result = await onConfirm(note);
    setSubmitting(false);
    if (!result.success) {
      setError(result.error || 'Erreur lors de la mise à jour');
      return;
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto">
      <div className="fixed inset-0 bg-black bg-opacity-40" onClick={() => !submitting && onClose()} />
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-base font-semibold text-gray-900">Marquer comme envoyé</h3>
            <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 rounded-lg transition-colors">
              <X className="h-5 w-5" />
            </button>
          </div>
          <p className="text-sm text-gray-500">
            {gift.quantity} portefeuille{gift.quantity > 1 ? 's' : ''} offert{gift.quantity > 1 ? 's' : ''} — {gift.company_name}
          </p>

          <div className="mt-4">
            <label htmlFor="shipped-note" className="block text-sm font-medium text-gray-700 mb-1">
              Note (modèle envoyé, remarque...) — optionnel
            </label>
            <textarea
              id="shipped-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="Ex : portefeuille cuir noir modèle Cardholder"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent text-sm"
            />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-center space-x-2 mt-3">
              <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          <div className="flex justify-end space-x-3 mt-5">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors text-sm disabled:opacity-50"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={submitting}
              className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors text-sm font-medium disabled:opacity-50"
            >
              {submitting ? 'Envoi...' : "Confirmer l'envoi"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

/** Suivi logistique des portefeuilles offerts (1 par tranche de 500 €
 * rechargée, générés automatiquement — voir 0101_b2b_gift_rewards.sql) :
 * remplace l'ancien menu "Portail B2B" dans la nav Revendeurs. */
export const GiftRewards: React.FC = () => {
  const { isAdmin } = useAdminAuth();
  const { rewards, loading, error, assignToOrder, markShipped } = useGiftRewards(isAdmin);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [assigningGift, setAssigningGift] = useState<GiftReward | null>(null);
  const [shippingGift, setShippingGift] = useState<GiftReward | null>(null);

  const filteredRewards = useMemo(() => {
    if (statusFilter === 'due') return rewards.filter((r) => r.status !== 'shipped');
    if (statusFilter === 'shipped') return rewards.filter((r) => r.status === 'shipped');
    return rewards;
  }, [rewards, statusFilter]);

  const totalDue = rewards.reduce((sum, r) => sum + r.quantity, 0);
  const totalPending = rewards.filter((r) => r.status !== 'shipped').reduce((sum, r) => sum + r.quantity, 0);
  const totalShipped = rewards.filter((r) => r.status === 'shipped').reduce((sum, r) => sum + r.quantity, 0);

  return (
    <div className="p-4 md:p-6">
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-gray-900">Portefeuilles offerts</h3>
        <p className="text-sm text-gray-500">
          1 portefeuille offert par tranche de 500 € rechargés — généré automatiquement à chaque recharge éligible.
        </p>
      </div>

      {!loading && !error && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <Gift className="h-4 w-4 text-gray-400" />
                <p className="text-xs text-gray-500">Total offerts dus</p>
              </div>
              <p className="text-xl font-semibold text-gray-900">{totalDue}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <PackageX className="h-4 w-4 text-amber-500" />
                <p className="text-xs text-gray-500">En attente d'expédition</p>
              </div>
              <p className="text-xl font-semibold text-amber-600">{totalPending}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <PackageCheck className="h-4 w-4 text-green-500" />
                <p className="text-xs text-gray-500">Total expédiés</p>
              </div>
              <p className="text-xl font-semibold text-green-600">{totalShipped}</p>
            </CardContent>
          </Card>
        </div>
      )}

      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 flex items-center space-x-3">
          <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0" />
          <p className="text-sm text-red-700">Erreur : {error}</p>
        </div>
      )}

      <div className="flex items-center gap-2 mb-4">
        {([
          { id: 'all', label: 'Tous' },
          { id: 'due', label: 'À envoyer uniquement' },
          { id: 'shipped', label: 'Envoyés' },
        ] as { id: StatusFilter; label: string }[]).map((f) => (
          <button
            key={f.id}
            onClick={() => setStatusFilter(f.id)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              statusFilter === f.id ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {!loading && !error && filteredRewards.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-gray-200 rounded-lg">
          <Gift className="h-10 w-10 text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-500">Aucun portefeuille offert pour ce filtre.</p>
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left py-3 px-4 font-medium text-gray-900 text-sm">Date du rechargement</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-900 text-sm">Revendeur / Sous-compte</th>
                    <th className="text-right py-3 px-4 font-medium text-gray-900 text-sm">Montant rechargé</th>
                    <th className="text-right py-3 px-4 font-medium text-gray-900 text-sm">Offerts dus</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-900 text-sm">Statut</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-900 text-sm">Commande associée</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-900 text-sm">Date d'expédition</th>
                    <th className="text-right py-3 px-4 font-medium text-gray-900 text-sm">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    [...Array(3)].map((_, i) => (
                      <tr key={`skeleton-${i}`} className="border-b border-gray-50">
                        <td className="py-4 px-4" colSpan={8}>
                          <div className="h-4 w-full bg-gray-100 rounded animate-pulse" />
                        </td>
                      </tr>
                    ))
                  ) : (
                    filteredRewards.map((gift) => (
                      <tr key={gift.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                        <td className="py-3 px-4 text-sm text-gray-600">
                          {gift.recharge_date ? new Date(gift.recharge_date).toLocaleDateString('fr-FR') : '—'}
                        </td>
                        <td className="py-3 px-4 text-sm text-gray-900">
                          <p className="font-semibold">{gift.requester_name}</p>
                          <p className="text-xs text-gray-500">{gift.company_name}</p>
                        </td>
                        <td className="py-3 px-4 text-right text-sm text-gray-900 tabular-nums">{gift.recharge_amount.toFixed(2)} €</td>
                        <td className="py-3 px-4 text-right text-sm font-semibold text-gray-900 tabular-nums">{gift.quantity}</td>
                        <td className="py-3 px-4">{statusBadge(gift.status)}</td>
                        <td className="py-3 px-4 text-sm text-gray-600">
                          {gift.assigned_order_number ? `#${gift.assigned_order_number}` : '—'}
                        </td>
                        <td className="py-3 px-4 text-sm text-gray-600">
                          {gift.shipped_at ? new Date(gift.shipped_at).toLocaleDateString('fr-FR') : '—'}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            {gift.status === 'pending' && (
                              <button
                                onClick={() => setAssigningGift(gift)}
                                className="text-xs font-medium text-gray-600 hover:text-gray-900 underline"
                              >
                                Assigner à une commande
                              </button>
                            )}
                            {gift.status !== 'shipped' && (
                              <button
                                onClick={() => setShippingGift(gift)}
                                className="flex items-center gap-1 px-2.5 py-1.5 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors text-xs font-medium"
                              >
                                <Send className="h-3 w-3" />
                                Marquer envoyé
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <AssignGiftToOrderModal
        isOpen={assigningGift !== null}
        resellerId={assigningGift?.reseller_id || null}
        onClose={() => setAssigningGift(null)}
        onAssign={(orderId) => {
          if (!assigningGift) return Promise.resolve({ success: false, error: 'Portefeuille inconnu' });
          return assignToOrder(assigningGift.id, orderId);
        }}
      />

      <MarkShippedModal
        gift={shippingGift}
        onClose={() => setShippingGift(null)}
        onConfirm={(note) => {
          if (!shippingGift) return Promise.resolve({ success: false, error: 'Portefeuille inconnu' });
          return markShipped(shippingGift.id, { note });
        }}
      />
    </div>
  );
};

export default GiftRewards;
