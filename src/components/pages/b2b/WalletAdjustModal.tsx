import React, { useState } from 'react';
import { X, AlertCircle, PlusCircle, MinusCircle } from 'lucide-react';

interface WalletAdjustModalProps {
  isOpen: boolean;
  currentBalance: number;
  onClose: () => void;
  onSubmit: (amount: number, note: string) => Promise<{ success: boolean; error?: string }>;
}

export const WalletAdjustModal: React.FC<WalletAdjustModalProps> = ({ isOpen, currentBalance, onClose, onSubmit }) => {
  const [direction, setDirection] = useState<'credit' | 'debit'>('credit');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const reset = () => {
    setDirection('credit');
    setAmount('');
    setNote('');
    setError('');
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError('Le montant doit être supérieur à 0');
      return;
    }
    if (!note.trim()) {
      setError('Une note explicative est requise');
      return;
    }
    if (direction === 'debit' && parsed > currentBalance) {
      setError('Le retrait dépasse le solde disponible');
      return;
    }

    setSubmitting(true);
    setError('');
    const result = await onSubmit(direction === 'debit' ? -parsed : parsed, note.trim());
    setSubmitting(false);

    if (!result.success) {
      setError(result.error || "Erreur lors de l'ajustement");
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
            <h3 className="text-base font-semibold text-gray-900">Ajuster le solde</h3>
            <button onClick={handleClose} className="p-1 text-gray-400 hover:text-gray-600 rounded-lg transition-colors">
              <X className="h-5 w-5" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="p-5 space-y-4">
            <p className="text-sm text-gray-500">
              Solde actuel : <span className="font-medium text-gray-900">{currentBalance.toFixed(2)} €</span>
            </p>

            <div className="flex rounded-lg border border-gray-200 p-1 text-sm">
              <button
                type="button"
                onClick={() => setDirection('credit')}
                className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md transition-colors ${
                  direction === 'credit' ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                <PlusCircle className="h-3.5 w-3.5" />
                Créditer
              </button>
              <button
                type="button"
                onClick={() => setDirection('debit')}
                className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md transition-colors ${
                  direction === 'debit' ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                <MinusCircle className="h-3.5 w-3.5" />
                Retirer
              </button>
            </div>

            <div>
              <label htmlFor="adjust-amount" className="block text-sm font-medium text-gray-700 mb-1">Montant</label>
              <div className="relative">
                <input
                  id="adjust-amount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent pr-10"
                  placeholder="Ex : 100"
                  required
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">€</span>
              </div>
            </div>

            <div>
              <label htmlFor="adjust-note" className="block text-sm font-medium text-gray-700 mb-1">Note explicative *</label>
              <textarea
                id="adjust-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent resize-none"
                placeholder="Ex : geste commercial suite à un retard de livraison"
                required
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
                {submitting ? 'Enregistrement...' : 'Confirmer'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
