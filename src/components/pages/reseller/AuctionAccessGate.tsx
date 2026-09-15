import React, { useState } from 'react';
import { Gavel, AlertCircle } from 'lucide-react';

interface AuctionAccessGateProps {
  onSubmitCode: (code: string) => boolean;
}

/** Écran plein cadre (pas de modale) affiché à la place du contenu de
 * l'onglet "Enchères" tant que la session n'est pas déverrouillée — voir
 * useAuctionAccess. Remplace l'ancien cadenas discret + modale
 * (AuctionAccessModal, supprimée) : l'onglet est désormais visible dans la
 * nav, mais son contenu reste gaté le temps de l'accès anticipé. */
export const AuctionAccessGate: React.FC<AuctionAccessGateProps> = ({ onSubmitCode }) => {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!onSubmitCode(code)) {
      setError('Code incorrect');
      return;
    }
  };

  return (
    <div className="flex items-center justify-center py-16 px-4">
      <div className="w-full max-w-sm bg-white rounded-xl shadow-sm border border-gray-100 p-8 text-center">
        <div className="mx-auto mb-5 h-12 w-12 rounded-full bg-gray-900 flex items-center justify-center">
          <Gavel className="h-5 w-5 text-white" />
        </div>
        <h2 className="text-lg font-semibold text-gray-900">Ventes aux enchères B2B</h2>
        <p className="mt-2 text-sm text-gray-500">
          Fonctionnalité en accès anticipé. Entrez le code d'accès pour débloquer la session.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-3">
          <input
            type="password"
            autoFocus
            value={code}
            onChange={(e) => { setCode(e.target.value); setError(''); }}
            placeholder="Code d'accès"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent text-sm text-center"
          />
          {error && (
            <div className="flex items-center justify-center gap-2 text-red-600 text-sm">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}
          <button
            type="submit"
            className="w-full px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors text-sm font-medium"
          >
            Accéder
          </button>
        </form>
      </div>
    </div>
  );
};

export default AuctionAccessGate;
