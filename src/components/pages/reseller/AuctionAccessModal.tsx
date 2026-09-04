import React, { useState } from 'react';
import { Lock, X, AlertCircle } from 'lucide-react';

interface AuctionAccessModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmitCode: (code: string) => boolean;
}

/** Modale déclenchée par le petit cadenas discret de la nav (voir
 * ResellerApp.tsx) — "mode sous-marin" : aucun onglet visible, seul ce
 * cadenas permet d'entrer. */
export const AuctionAccessModal: React.FC<AuctionAccessModalProps> = ({ isOpen, onClose, onSubmitCode }) => {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleClose = () => {
    setCode('');
    setError('');
    onClose();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const success = onSubmitCode(code);
    if (!success) {
      setError('Code incorrect');
      return;
    }
    handleClose();
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black bg-opacity-50" onClick={handleClose} />
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white rounded-xl shadow-xl w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between p-5 border-b border-gray-100">
            <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2">
              <Lock className="h-4 w-4" />
              Code d'accès
            </h3>
            <button onClick={handleClose} className="p-1 text-gray-400 hover:text-gray-600 rounded-lg transition-colors">
              <X className="h-5 w-5" />
            </button>
          </div>

          <form onSubmit={handleSubmit}>
            <div className="p-5 space-y-3">
              <input
                type="password"
                autoFocus
                value={code}
                onChange={(e) => { setCode(e.target.value); setError(''); }}
                placeholder="Entrez le code d'accès"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent text-sm"
              />
              {error && (
                <div className="flex items-center gap-2 text-red-600 text-sm">
                  <AlertCircle className="h-4 w-4 flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3 p-5 pt-0">
              <button type="button" onClick={handleClose} className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors text-sm">
                Annuler
              </button>
              <button type="submit" className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors text-sm font-medium">
                Valider
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default AuctionAccessModal;
