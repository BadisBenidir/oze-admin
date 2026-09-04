import React, { useState } from 'react';
import { Card, CardContent } from '../../ui/Card';
import { Toast } from '../../ui/Toast';
import { useSalesJournalExport, SalesJournalScope } from '../../../hooks/useSalesJournalExport';
import { Download, AlertCircle } from 'lucide-react';

const todayIsoDate = () => new Date().toISOString().slice(0, 10);

/** Bloc "Export Journal des Ventes" (.xlsx) de l'onglet Rapports financiers —
 * voir useSalesJournalExport.ts pour l'agrégation web/B2B/sourcing et le
 * calcul TVA (régime standard 20%, confirmé — aucun autre régime référencé
 * ailleurs dans ce repo). */
export const SalesJournalExport: React.FC = () => {
  const { exporting, exportJournal } = useSalesJournalExport();
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState(todayIsoDate());
  const [scope, setScope] = useState<SalesJournalScope>('all');
  const [error, setError] = useState('');
  const [successToast, setSuccessToast] = useState<string | null>(null);

  const handleExport = async () => {
    setError('');
    if (!startDate) {
      setError('La date de début est requise');
      return;
    }
    const result = await exportJournal(startDate, endDate, scope);
    if (!result.success) {
      setError(result.error || "Erreur lors de l'export");
      return;
    }
    setSuccessToast(`Export généré : ${result.rowsCount} vente${(result.rowsCount || 0) > 1 ? 's' : ''}.`);
  };

  return (
    <Card className="mb-6">
      <CardContent className="p-4 md:p-6">
        <h3 className="text-base font-semibold text-gray-900 mb-1">Export Journal des Ventes</h3>
        <p className="text-sm text-gray-500 mb-4">Génère un fichier Excel (.xlsx) du registre des ventes pour votre comptable.</p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
          <div>
            <label htmlFor="journal-start-date" className="block text-xs font-medium text-gray-700 mb-1">Date de début</label>
            <input
              id="journal-start-date"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-gray-400"
              required
            />
          </div>
          <div>
            <label htmlFor="journal-end-date" className="block text-xs font-medium text-gray-700 mb-1">Date de fin</label>
            <input
              id="journal-end-date"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-gray-400"
            />
          </div>
          <div>
            <label htmlFor="journal-scope" className="block text-xs font-medium text-gray-700 mb-1">Périmètre</label>
            <select
              id="journal-scope"
              value={scope}
              onChange={(e) => setScope(e.target.value as SalesJournalScope)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-gray-400 bg-white"
            >
              <option value="all">Toutes les ventes</option>
              <option value="web">Web B2C uniquement</option>
              <option value="b2b">Commandes B2B uniquement</option>
              <option value="sourcing">Avances Sourcing uniquement</option>
            </select>
          </div>
        </div>

        {error && (
          <div className="mb-3 bg-red-50 border border-red-200 rounded-lg p-3 flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        <button
          onClick={handleExport}
          disabled={exporting}
          className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50 text-sm font-medium"
        >
          <Download className="h-4 w-4" />
          {exporting ? 'Génération...' : 'Exporter vers Excel'}
        </button>

        <p className="text-xs text-gray-400 mt-3">
          Base HT / TVA collectée calculées au régime standard (20%) — Base HT = TTC ÷ 1,2 — via de vraies formules Excel, éditables par votre comptable.
        </p>
      </CardContent>

      {successToast && <Toast message={successToast} onDismiss={() => setSuccessToast(null)} />}
    </Card>
  );
};

export default SalesJournalExport;
