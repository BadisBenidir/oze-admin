import React, { useState } from 'react';
import { X, AlertCircle } from 'lucide-react';
import { AuctionSessionInput } from '../../../../hooks/useAdminAuctionSessions';

interface AuctionSessionFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (input: AuctionSessionInput) => Promise<{ success: boolean; error?: string }>;
}

const pad = (n: number) => String(n).padStart(2, '0');
const toLocalInputValue = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** Prochain vendredi (aujourd'hui inclus s'il est déjà vendredi) à l'heure
 * donnée — valeurs par défaut du formulaire, format hebdomadaire 10h-20h. */
const nextFridayAt = (hour: number, minute: number): Date => {
  const d = new Date();
  const diff = (5 - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + diff);
  d.setHours(hour, minute, 0, 0);
  return d;
};

/** Formulaire de création d'une session d'enchères hebdomadaire — voir
 * auction_sessions, 0104_auction_system.sql. */
export const AuctionSessionFormModal: React.FC<AuctionSessionFormModalProps> = ({ isOpen, onClose, onSubmit }) => {
  const [title, setTitle] = useState('');
  const [startsAt, setStartsAt] = useState(() => toLocalInputValue(nextFridayAt(10, 0)));
  const [endsAt, setEndsAt] = useState(() => toLocalInputValue(nextFridayAt(20, 0)));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const reset = () => {
    setTitle('');
    setStartsAt(toLocalInputValue(nextFridayAt(10, 0)));
    setEndsAt(toLocalInputValue(nextFridayAt(20, 0)));
    setError('');
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError('Le titre est requis');
      return;
    }
    if (new Date(endsAt) <= new Date(startsAt)) {
      setError('La date de fin doit être après la date de début');
      return;
    }
    setSubmitting(true);
    setError('');
    const result = await onSubmit({
      title: title.trim(),
      starts_at: new Date(startsAt).toISOString(),
      ends_at: new Date(endsAt).toISOString(),
    });
    setSubmitting(false);
    if (!result.success) {
      setError(result.error || 'Erreur lors de la création');
      return;
    }
    handleClose();
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black bg-opacity-25" onClick={handleClose} />
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between p-5 border-b border-gray-100">
            <h3 className="text-base font-semibold text-gray-900">Créer une session</h3>
            <button onClick={handleClose} className="p-1 text-gray-400 hover:text-gray-600 rounded-lg transition-colors">
              <X className="h-5 w-5" />
            </button>
          </div>

          <form onSubmit={handleSubmit}>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Titre de la session</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder='Ex : "Session #01 - Vendredi 12 Septembre"'
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Début</label>
                  <input
                    type="datetime-local"
                    value={startsAt}
                    onChange={(e) => setStartsAt(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Fin</label>
                  <input
                    type="datetime-local"
                    value={endsAt}
                    onChange={(e) => setEndsAt(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent text-sm"
                  />
                </div>
              </div>
              <p className="text-xs text-gray-400">
                La session démarre au statut "À venir" — utilisez le bouton "Lancer en direct" au moment voulu pour la passer en 'live'.
              </p>

              {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-center space-x-2">
                  <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0" />
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              )}
            </div>

            <div className="flex justify-end space-x-3 p-5 pt-0">
              <button type="button" onClick={handleClose} className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors text-sm">
                Annuler
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50 text-sm font-medium"
              >
                {submitting ? 'Création...' : 'Créer la session'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default AuctionSessionFormModal;
