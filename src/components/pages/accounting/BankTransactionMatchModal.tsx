import React, { useEffect, useState } from 'react';
import { X, AlertCircle } from 'lucide-react';
import { BankTransaction, MatchedType } from '../../../hooks/useBankTransactions';
import { useSourcingMissions } from '../../../hooks/useSourcingMissions';
import { useExpenses } from '../../../hooks/useExpenses';
import { AccountingOrder } from '../../../hooks/useAccountingRawData';

interface BankTransactionMatchModalProps {
  transaction: BankTransaction | null;
  orders: AccountingOrder[];
  onClose: () => void;
  onSave: (updates: {
    reconciliation_status: 'unmatched' | 'matched' | 'ignored';
    matched_type: MatchedType;
    matched_order_id?: string | null;
    matched_sourcing_mission_id?: string | null;
    matched_expense_id?: string | null;
    note?: string | null;
  }) => Promise<{ success: boolean; error?: string }>;
}

const EUR = (n: number) => (Number(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';

/** Rapprochement manuel d'UNE transaction bancaire : commande (web ou B2B),
 * mission de sourcing sur mesure, dépense existante (ex: "Dédouanement
 * DHL"), ou "Autre" avec une simple note libre. */
export const BankTransactionMatchModal: React.FC<BankTransactionMatchModalProps> = ({ transaction, orders, onClose, onSave }) => {
  const { missions } = useSourcingMissions(undefined, Boolean(transaction));
  const { expenses } = useExpenses(Boolean(transaction));

  const [type, setType] = useState<MatchedType>(null);
  const [orderId, setOrderId] = useState('');
  const [missionId, setMissionId] = useState('');
  const [expenseId, setExpenseId] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!transaction) return;
    setType(transaction.matched_type);
    setOrderId(transaction.matched_order_id || '');
    setMissionId(transaction.matched_sourcing_mission_id || '');
    setExpenseId(transaction.matched_expense_id || '');
    setNote(transaction.note || '');
    setError('');
  }, [transaction]);

  if (!transaction) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (type === 'order' && !orderId) return setError('Choisis une commande');
    if (type === 'sourcing_mission' && !missionId) return setError('Choisis une mission de sourcing');
    if (type === 'expense' && !expenseId) return setError('Choisis une dépense');

    setSaving(true);
    const result = await onSave({
      reconciliation_status: type ? 'matched' : 'unmatched',
      matched_type: type,
      matched_order_id: type === 'order' ? orderId : null,
      matched_sourcing_mission_id: type === 'sourcing_mission' ? missionId : null,
      matched_expense_id: type === 'expense' ? expenseId : null,
      note: note.trim() || null,
    });
    setSaving(false);

    if (!result.success) {
      setError(result.error || 'Erreur lors du rapprochement');
      return;
    }
    onClose();
  };

  const handleIgnore = async () => {
    setSaving(true);
    const result = await onSave({ reconciliation_status: 'ignored', matched_type: null });
    setSaving(false);
    if (!result.success) {
      setError(result.error || "Erreur");
      return;
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black bg-opacity-25" onClick={onClose} />
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white rounded-xl shadow-xl w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between p-5 border-b border-gray-100">
            <div>
              <h3 className="text-base font-semibold text-gray-900">Associer cette transaction</h3>
              <p className="text-xs text-gray-500 mt-0.5">
                {transaction.label || transaction.counterparty_name || transaction.qonto_transaction_id} · {EUR(transaction.amount)}
              </p>
            </div>
            <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 rounded-lg transition-colors">
              <X className="h-5 w-5" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="p-5 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Associer à</label>
              <select
                value={type || ''}
                onChange={(e) => setType((e.target.value || null) as MatchedType)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent text-sm bg-white"
              >
                <option value="">Non rapproché</option>
                <option value="order">Commande (web ou B2B)</option>
                <option value="sourcing_mission">Sourcing sur mesure</option>
                <option value="expense">Dépense (ex: Dédouanement DHL)</option>
                <option value="stripe_payout">Reversement Stripe (groupé)</option>
                <option value="other">Autre</option>
              </select>
            </div>

            {type === 'order' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Commande web #X / B2B #X</label>
                <select
                  value={orderId}
                  onChange={(e) => setOrderId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent text-sm bg-white"
                >
                  <option value="">Sélectionner...</option>
                  {orders.slice(0, 200).map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.order_number} — {o.order_channel === 'b2b' ? o.company_name || 'B2B' : o.customer_name} — {EUR(o.total_amount)}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {type === 'sourcing_mission' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Mission de sourcing</label>
                <select
                  value={missionId}
                  onChange={(e) => setMissionId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent text-sm bg-white"
                >
                  <option value="">Sélectionner...</option>
                  {missions.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.reference || m.title} — {m.company_name} — {EUR(m.advance_amount)}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {type === 'expense' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Dépense</label>
                <select
                  value={expenseId}
                  onChange={(e) => setExpenseId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent text-sm bg-white"
                >
                  <option value="">Sélectionner...</option>
                  {expenses.map((exp) => (
                    <option key={exp.id} value={exp.id}>
                      {exp.label} — {EUR(exp.amount)} — {new Date(exp.spent_at).toLocaleDateString('fr-FR')}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-gray-400 mt-1">
                  La dépense doit déjà exister (onglet Dépenses) — crée-la d'abord si besoin, ex: "Dédouanement DHL".
                </p>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Note (optionnel)</label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent resize-none text-sm"
                placeholder="Ex: acompte client par virement, cf. échange email du..."
              />
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-center space-x-2">
                <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0" />
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}

            <div className="flex justify-between pt-2">
              <button
                type="button"
                onClick={handleIgnore}
                disabled={saving}
                className="px-4 py-2 text-gray-500 hover:text-gray-700 text-sm disabled:opacity-50"
              >
                Ignorer cette transaction
              </button>
              <div className="flex space-x-3">
                <button type="button" onClick={onClose} className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors text-sm">
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50 text-sm font-medium"
                >
                  {saving ? 'Enregistrement...' : 'Enregistrer'}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default BankTransactionMatchModal;
