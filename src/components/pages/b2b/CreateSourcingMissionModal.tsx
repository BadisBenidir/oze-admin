import React, { useEffect, useState } from 'react';
import { X, AlertCircle } from 'lucide-react';
import { SourcingMissionInput } from '../../../hooks/useSourcingMissions';
import { useResellers, ResellerContact } from '../../../hooks/useResellers';

interface CreateSourcingMissionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (input: SourcingMissionInput) => Promise<{ success: boolean; error?: string }>;
  /** Fixe l'entreprise (ouverture depuis l'onglet de la fiche revendeur) — masque le sélecteur entreprise. */
  fixedReseller?: { id: string; company_name: string };
}

export const CreateSourcingMissionModal: React.FC<CreateSourcingMissionModalProps> = ({ isOpen, onClose, onSubmit, fixedReseller }) => {
  // Liste des entreprises chargée seulement en mode "global" (pas de
  // fixedReseller) — inutile de la récupérer depuis l'onglet fiche
  // revendeur, où l'entreprise est déjà connue.
  const { resellers, fetchContacts } = useResellers(isOpen && !fixedReseller);
  const [resellerId, setResellerId] = useState('');
  const [contacts, setContacts] = useState<ResellerContact[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [userId, setUserId] = useState('');

  const [title, setTitle] = useState('');
  const [budgetAmount, setBudgetAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [paidAt, setPaidAt] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setResellerId(fixedReseller?.id || '');
  }, [isOpen, fixedReseller]);

  // Sous-comptes rechargés dynamiquement dès que l'entreprise change (fixe
  // ou choisie dans le sélecteur) — même pattern que ResellerDetail.tsx.
  useEffect(() => {
    if (!isOpen || !resellerId) {
      setContacts([]);
      setUserId('');
      return;
    }
    let mounted = true;
    setLoadingContacts(true);
    fetchContacts(resellerId)
      .then((data) => {
        if (!mounted) return;
        setContacts(data);
        setUserId(data.find((c) => c.is_primary)?.profile_id || '');
      })
      .finally(() => {
        if (mounted) setLoadingContacts(false);
      });
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, resellerId]);

  const reset = () => {
    setResellerId('');
    setContacts([]);
    setUserId('');
    setTitle('');
    setBudgetAmount('');
    setPaymentMethod('');
    setPaidAt('');
    setNotes('');
    setError('');
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resellerId) {
      setError("L'entreprise est requise");
      return;
    }
    if (!title.trim()) {
      setError('Le titre de la mission est requis');
      return;
    }
    const parsedBudget = Number(budgetAmount);
    if (!Number.isFinite(parsedBudget) || parsedBudget <= 0) {
      setError('Le montant avancé doit être supérieur à 0');
      return;
    }

    setSubmitting(true);
    setError('');
    const result = await onSubmit({
      reseller_id: resellerId,
      user_id: userId || undefined,
      title: title.trim(),
      budget_amount: parsedBudget,
      payment_method: paymentMethod.trim() || undefined,
      paid_at: paidAt ? new Date(paidAt).toISOString() : undefined,
      notes: notes.trim() || undefined,
    });
    setSubmitting(false);

    if (!result.success) {
      setError(result.error || 'Erreur lors de la création de la mission');
      return;
    }
    handleClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black bg-opacity-25" onClick={handleClose} />
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between p-5 border-b border-gray-100">
            <h3 className="text-base font-semibold text-gray-900">Nouvelle avance / Mission de sourcing</h3>
            <button onClick={handleClose} className="p-1 text-gray-400 hover:text-gray-600 rounded-lg transition-colors">
              <X className="h-5 w-5" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="p-5 space-y-4">
            {fixedReseller ? (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Entreprise</label>
                <p className="text-sm text-gray-900 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">{fixedReseller.company_name}</p>
              </div>
            ) : (
              <div>
                <label htmlFor="mission-reseller" className="block text-sm font-medium text-gray-700 mb-1">Entreprise</label>
                <select
                  id="mission-reseller"
                  value={resellerId}
                  onChange={(e) => setResellerId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent text-sm bg-white"
                  required
                >
                  <option value="">Choisir une entreprise...</option>
                  {resellers.map((r) => (
                    <option key={r.id} value={r.id}>{r.company_name}</option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label htmlFor="mission-requester" className="block text-sm font-medium text-gray-700 mb-1">
                Demandeur (sous-compte)
              </label>
              <select
                id="mission-requester"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                disabled={!resellerId || loadingContacts}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent text-sm bg-white disabled:bg-gray-50 disabled:text-gray-400"
              >
                <option value="">Non précisé</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.profile_id}>
                    {c.first_name} {c.last_name} — {c.email}{c.is_primary ? ' (Principal)' : ''}
                  </option>
                ))}
              </select>
              {!resellerId && (
                <p className="text-xs text-gray-400 mt-1">Choisis d'abord une entreprise pour voir ses sous-comptes.</p>
              )}
            </div>

            <div>
              <label htmlFor="mission-title" className="block text-sm font-medium text-gray-700 mb-1">Titre de la mission</label>
              <input
                id="mission-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ex : Sourcing Japon Automne 2026"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent text-sm"
                required
              />
            </div>

            <div>
              <label htmlFor="mission-budget" className="block text-sm font-medium text-gray-700 mb-1">Montant avancé</label>
              <div className="relative">
                <input
                  id="mission-budget"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={budgetAmount}
                  onChange={(e) => setBudgetAmount(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent pr-10 text-sm"
                  placeholder="Ex : 5000"
                  required
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">€</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="mission-payment-method" className="block text-sm font-medium text-gray-700 mb-1">Moyen de paiement</label>
                <input
                  id="mission-payment-method"
                  type="text"
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  placeholder="Ex : Virement"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent text-sm"
                />
              </div>
              <div>
                <label htmlFor="mission-paid-at" className="block text-sm font-medium text-gray-700 mb-1">Date de paiement</label>
                <input
                  id="mission-paid-at"
                  type="date"
                  value={paidAt}
                  onChange={(e) => setPaidAt(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent text-sm"
                />
              </div>
            </div>
            <p className="text-xs text-gray-400 -mt-2">
              Une fois la date de paiement renseignée, l'avance est intégrée au chiffre d'affaires B2B.
            </p>

            <div>
              <label htmlFor="mission-notes" className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
              <textarea
                id="mission-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent resize-none text-sm"
                placeholder="Ex : brief transmis par le client, préférences de marques..."
              />
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-center space-x-2">
                <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0" />
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}

            <div className="flex justify-end space-x-3 pt-2">
              <button type="button" onClick={handleClose} className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors text-sm">
                Annuler
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50 text-sm font-medium"
              >
                {submitting ? 'Création...' : 'Créer la mission'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default CreateSourcingMissionModal;
