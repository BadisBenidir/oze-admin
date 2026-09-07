import React, { useMemo, useState } from 'react';
import { Wallet, TrendingUp, ShieldAlert, FileWarning, RefreshCw, Upload, Link2, Download, AlertCircle } from 'lucide-react';
import { Card, CardContent, CardHeader } from '../../ui/Card';
import { Badge } from '../../ui/Badge';
import { useAdminAuth } from '../../../hooks/useAdminAuth';
import { useBankTransactions, BankTransaction, MatchedType } from '../../../hooks/useBankTransactions';
import { useAccountingLedgerExport } from '../../../hooks/useAccountingLedgerExport';
import { AccountingRawData, isOrderPaid } from '../../../hooks/useAccountingRawData';
import { FRANCHISE_TVA_THRESHOLD, FRANCHISE_TVA_TOLERANCE_THRESHOLD } from '../../../config/accounting';
import { COMPANY_CREATION_DATE } from '../../../config/legal';
import { BankTransactionMatchModal } from './BankTransactionMatchModal';

const EUR = (n: number) => (Number(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';

const currentMonthIso = () => new Date().toISOString().slice(0, 7);

const matchedTypeBadge = (t: BankTransaction) => {
  if (t.reconciliation_status === 'ignored') return <Badge variant="default">Ignorée</Badge>;
  switch (t.matched_type as MatchedType) {
    case 'order':
      return <Badge variant="success">Commande liée</Badge>;
    case 'sourcing_mission':
      return <Badge variant="info">Sourcing lié</Badge>;
    case 'expense':
      return <Badge variant="purple">Dépense liée</Badge>;
    case 'stripe_payout':
      return <Badge variant="info">Reversement Stripe</Badge>;
    case 'other':
      return <Badge variant="default">Autre</Badge>;
    default:
      return <Badge variant="warning">Non rapproché</Badge>;
  }
};

interface QontoTabProps {
  data: AccountingRawData;
}

/** Trésorerie Qonto — synchronisée côté serveur (qonto-sync, jamais d'appel
 * direct à l'API Qonto depuis le navigateur, voir 0114_qonto_bank_transactions.sql).
 * OZË Paris est en franchise en base de TVA (art. 293 B, voir config/legal.ts
 * et Terms.tsx) : pas de calcul de TVA sur marge ici, seulement un suivi du
 * CA cumulé de l'année face au seuil de franchise. */
export const QontoTab: React.FC<QontoTabProps> = ({ data }) => {
  const { isAdmin } = useAdminAuth();
  const [monthFilter, setMonthFilter] = useState(currentMonthIso());
  const { transactions, snapshot, loading, error, syncing, syncNow, setReconciliation, uploadAttachment, missingReceiptsCount } =
    useBankTransactions(isAdmin, monthFilter);
  const { exporting, exportLedger } = useAccountingLedgerExport();

  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const [matchingTransaction, setMatchingTransaction] = useState<BankTransaction | null>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [exportStart, setExportStart] = useState(`${currentMonthIso()}-01`);
  const [exportEnd, setExportEnd] = useState(new Date().toISOString().slice(0, 10));
  const [exportNotice, setExportNotice] = useState<string | null>(null);

  const encaissementsMois = useMemo(
    () => transactions.filter((t) => t.side === 'credit').reduce((sum, t) => sum + Number(t.amount), 0),
    [transactions]
  );

  // CA cumulé depuis le 1er janvier de l'année en cours, JAMAIS avant la
  // création d'OZË PARIS SAS (COMPANY_CREATION_DATE) : l'activité tournait
  // avant sous un statut différent (micro-entreprise), dont le CA n'entre
  // pas dans le compteur de franchise de CETTE société. Les années
  // suivantes repartiront normalement du 1er janvier. Tous canaux confondus
  // (web, B2B, avances de sourcing encaissées) — même prédicat "encaissé"
  // que le reste du module (isOrderPaid, useAccountingRawData.ts).
  const yearToDateRevenue = useMemo(() => {
    const calendarYearStart = new Date(new Date().getFullYear(), 0, 1);
    const yearStart = new Date(Math.max(calendarYearStart.getTime(), new Date(COMPANY_CREATION_DATE).getTime()));
    const ordersRevenue = data.orders
      .filter((o) => isOrderPaid(o) && new Date(o.created_at) >= yearStart)
      .reduce((sum, o) => sum + Number(o.total_amount), 0);
    const sourcingRevenue = data.sourcingAdvances
      .filter((m) => m.paid_at && new Date(m.paid_at) >= yearStart)
      .reduce((sum, m) => sum + Number(m.advance_amount), 0);
    const liveRevenue = data.liveSales
      .filter((s) => new Date(s.sold_at) >= yearStart)
      .reduce((sum, s) => sum + Number(s.sale_price), 0);
    return ordersRevenue + sourcingRevenue + liveRevenue;
  }, [data]);

  const yearToDateStart = new Date(
    Math.max(new Date(new Date().getFullYear(), 0, 1).getTime(), new Date(COMPANY_CREATION_DATE).getTime())
  );
  const thresholdPercent = Math.min((yearToDateRevenue / FRANCHISE_TVA_THRESHOLD) * 100, 100);
  const overTolerance = yearToDateRevenue > FRANCHISE_TVA_TOLERANCE_THRESHOLD;
  const overThreshold = yearToDateRevenue > FRANCHISE_TVA_THRESHOLD;

  const handleSync = async () => {
    setSyncNotice(null);
    const result = await syncNow();
    setSyncNotice(
      result.success
        ? `${result.transactionsSynced ?? 0} transactions synchronisées, ${result.autoMatched ?? 0} rapprochées automatiquement.`
        : result.error || 'Échec de la synchronisation'
    );
  };

  const handleUpload = async (transactionId: string, file: File | null) => {
    if (!file) return;
    setUploadingId(transactionId);
    await uploadAttachment(transactionId, file);
    setUploadingId(null);
  };

  const handleExport = async () => {
    setExportNotice(null);
    const result = await exportLedger(exportStart, exportEnd);
    if (!result.success) setExportNotice(result.error || "Échec de l'export");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h4 className="text-base font-semibold text-gray-900">Trésorerie Qonto</h4>
          <p className="text-sm text-gray-500">
            {snapshot ? (
              <>Solde synchronisé le {new Date(snapshot.fetched_at).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</>
            ) : (
              'Aucune synchronisation encore effectuée'
            )}
          </p>
        </div>
        <button
          onClick={handleSync}
          disabled={syncing}
          className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
          {syncing ? 'Synchronisation...' : 'Rafraîchir les données bancaires'}
        </button>
      </div>

      {syncNotice && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
          <p className="text-sm text-amber-800">{syncNotice}</p>
        </div>
      )}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-3">
          <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0" />
          <p className="text-sm text-red-700">Erreur : {error}</p>
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-1">
              <p className="text-sm font-medium text-gray-600">Trésorerie Qonto</p>
              <Wallet className="h-4 w-4 text-gray-400" />
            </div>
            <p className="text-xl font-bold text-gray-900">{snapshot ? EUR(snapshot.balance) : '—'}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-1">
              <p className="text-sm font-medium text-gray-600">Encaissements du mois</p>
              <TrendingUp className="h-4 w-4 text-gray-400" />
            </div>
            <p className="text-xl font-bold text-gray-900">{EUR(encaissementsMois)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-1">
              <p className="text-sm font-medium text-gray-600">TVA</p>
              <ShieldAlert className={`h-4 w-4 ${overThreshold ? 'text-red-500' : 'text-gray-400'}`} />
            </div>
            <p className="text-xl font-bold text-gray-900">0,00 € dû</p>
            <p className="text-xs text-gray-500 mt-0.5">Franchise en base (art. 293 B)</p>
            <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden mt-2">
              <div
                className={`h-full rounded-full transition-all ${overThreshold ? 'bg-red-500' : 'bg-gray-900'}`}
                style={{ width: `${thresholdPercent}%` }}
              />
            </div>
            <p className={`text-[11px] mt-1 ${overThreshold ? 'text-red-600 font-medium' : 'text-gray-400'}`}>
              CA depuis le {yearToDateStart.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })} : {EUR(yearToDateRevenue)} / {EUR(FRANCHISE_TVA_THRESHOLD)}
              {overTolerance && ' — seuil majoré dépassé, sortie immédiate de la franchise'}
              {!overTolerance && overThreshold && ' — seuil dépassé (sortie si 2 années consécutives)'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-1">
              <p className="text-sm font-medium text-gray-600">Justificatifs manquants</p>
              <FileWarning className={`h-4 w-4 ${missingReceiptsCount > 0 ? 'text-amber-500' : 'text-gray-400'}`} />
            </div>
            <p className="text-xl font-bold text-gray-900">{missingReceiptsCount}</p>
            <p className="text-xs text-gray-500 mt-0.5">Sorties sans pièce jointe</p>
          </CardContent>
        </Card>
      </div>

      {/* Rapprochement & Opérations */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <h3 className="text-sm font-semibold text-gray-900">Rapprochement &amp; Opérations</h3>
            <input
              type="month"
              value={monthFilter}
              onChange={(e) => setMonthFilter(e.target.value)}
              className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-gray-400"
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left py-3 px-4 font-medium text-gray-900 text-sm">Date</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-900 text-sm">Type</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-900 text-sm">Libellé / Émetteur</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-900 text-sm">Montant</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-900 text-sm">Rapprochement</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-900 text-sm">Justificatif</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-900 text-sm">Action</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  [...Array(3)].map((_, i) => (
                    <tr key={i} className="border-b border-gray-50">
                      <td className="py-4 px-4" colSpan={7}>
                        <div className="h-4 w-full bg-gray-100 rounded animate-pulse" />
                      </td>
                    </tr>
                  ))
                ) : transactions.length === 0 ? (
                  <tr>
                    <td className="py-8 px-4 text-center text-sm text-gray-500" colSpan={7}>
                      Aucune transaction pour ce mois. Essaie "Rafraîchir les données bancaires".
                    </td>
                  </tr>
                ) : (
                  transactions.map((t) => (
                    <tr key={t.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                      <td className="py-3 px-4 text-sm text-gray-600 whitespace-nowrap">
                        {t.settled_at ? new Date(t.settled_at).toLocaleDateString('fr-FR') : '—'}
                      </td>
                      <td className="py-3 px-4">
                        <Badge variant={t.side === 'credit' ? 'success' : 'default'}>
                          {t.side === 'credit' ? 'Entrée' : 'Sortie'}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 text-sm text-gray-900 max-w-xs truncate">
                        {t.label || t.counterparty_name || t.qonto_transaction_id}
                      </td>
                      <td className={`py-3 px-4 text-sm font-semibold whitespace-nowrap ${t.side === 'credit' ? 'text-green-700' : 'text-gray-900'}`}>
                        {t.side === 'credit' ? '+' : '-'}{EUR(t.amount)}
                      </td>
                      <td className="py-3 px-4">{matchedTypeBadge(t)}</td>
                      <td className="py-3 px-4">
                        {t.attachment_ids.length > 0 ? (
                          <Badge variant="success">{t.attachment_ids.length} pièce{t.attachment_ids.length > 1 ? 's' : ''}</Badge>
                        ) : t.side === 'debit' ? (
                          <Badge variant="warning">Manquant</Badge>
                        ) : (
                          <span className="text-xs text-gray-400">—</span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => setMatchingTransaction(t)}
                            className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                            title="Associer à..."
                          >
                            <Link2 className="h-4 w-4" />
                          </button>
                          <label
                            className={`p-2 rounded-lg transition-colors cursor-pointer ${
                              uploadingId === t.id ? 'text-gray-300' : 'text-gray-400 hover:text-purple-600 hover:bg-purple-50'
                            }`}
                            title="Uploader justificatif"
                          >
                            <Upload className="h-4 w-4" />
                            <input
                              type="file"
                              accept="application/pdf,image/*"
                              className="hidden"
                              disabled={uploadingId === t.id}
                              onChange={(e) => handleUpload(t.id, e.target.files?.[0] || null)}
                            />
                          </label>
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

      {/* Export comptable */}
      <Card>
        <CardHeader>
          <h3 className="text-sm font-semibold text-gray-900">Export comptable</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Journal de banque (compte 512000), pour ton expert-comptable — pas un export FEC en partie double complet.
          </p>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Du</label>
            <input
              type="date"
              value={exportStart}
              onChange={(e) => setExportStart(e.target.value)}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-gray-400"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Au</label>
            <input
              type="date"
              value={exportEnd}
              onChange={(e) => setExportEnd(e.target.value)}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-gray-400"
            />
          </div>
          <button
            onClick={handleExport}
            disabled={exporting}
            className="flex items-center gap-1.5 px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50 text-sm font-medium"
          >
            <Download className="h-4 w-4" />
            {exporting ? 'Génération...' : 'Télécharger export comptable (Excel)'}
          </button>
          {exportNotice && <p className="text-sm text-red-600 w-full">{exportNotice}</p>}
        </CardContent>
      </Card>

      <BankTransactionMatchModal
        transaction={matchingTransaction}
        orders={data.orders}
        onClose={() => setMatchingTransaction(null)}
        onSave={(updates) => (matchingTransaction ? setReconciliation(matchingTransaction.id, updates) : Promise.resolve({ success: false }))}
      />
    </div>
  );
};

export default QontoTab;
