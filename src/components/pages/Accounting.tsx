import React, { useMemo, useState } from 'react';
import { LayoutDashboard, Globe, Handshake, Gavel, AlertCircle } from 'lucide-react';
import { useAdminAuth } from '../../hooks/useAdminAuth';
import { useAccountingRawData } from '../../hooks/useAccountingRawData';
import { buildAccountingPeriod, PeriodPreset } from '../../utils/accountingPeriods';
import { AccountingToolbar } from './accounting/AccountingToolbar';
import { SalesJournalExport } from './accounting/SalesJournalExport';
import { DashboardGlobalTab } from './accounting/DashboardGlobalTab';
import { B2CTab } from './accounting/B2CTab';
import { B2BTab } from './accounting/B2BTab';
import { LivesTab } from './accounting/LivesTab';

type AccountingTab = 'global' | 'b2c' | 'b2b' | 'lives';

const TABS: { id: AccountingTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'global', label: 'Dashboard Global', icon: LayoutDashboard },
  { id: 'b2c', label: 'B2C (Site Web)', icon: Globe },
  { id: 'b2b', label: 'B2B (Revendeurs & Sourcing)', icon: Handshake },
  { id: 'lives', label: 'Lives', icon: Gavel },
];

const todayIso = () => new Date().toISOString().slice(0, 10);

/** Comptabilité & Finances — architecture entièrement revue autour d'une
 * période/comparaison globale (voir accountingPeriods.ts) et d'un unique
 * chargement de données (useAccountingRawData, fenêtre glissante de 25
 * mois) partagé par les 4 onglets : changer de période ou d'onglet ne
 * relance jamais de requête, tout est déjà en mémoire. Remplace
 * intégralement l'ancienne page (6 sous-onglets ad hoc, dont "Factures" non
 * fonctionnel faute d'edge function, et le suivi de dépenses/CRUD `expenses`
 * qui n'a pas de place dans cette nouvelle architecture centrée CA/marge —
 * la table et le hook useExpenses restent intacts en base si besoin de les
 * exposer ailleurs plus tard). */
export const Accounting: React.FC = () => {
  const { isAdmin } = useAdminAuth();
  const { data, loading, error } = useAccountingRawData(isAdmin);

  const [activeTab, setActiveTab] = useState<AccountingTab>('global');
  const [preset, setPreset] = useState<PeriodPreset>('current-month');
  const [customStart, setCustomStart] = useState(todayIso());
  const [customEnd, setCustomEnd] = useState(todayIso());
  const [compareMoM, setCompareMoM] = useState(true);
  const [compareYoY, setCompareYoY] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  const period = useMemo(
    () => buildAccountingPeriod(preset, compareMoM, compareYoY, customStart, customEnd),
    [preset, compareMoM, compareYoY, customStart, customEnd]
  );

  return (
    <div className="p-4 md:p-6">
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-gray-900">Comptabilité & Finances</h3>
        <p className="text-sm text-gray-500">Chiffre d'affaires, marges et trésorerie consolidés — tous canaux</p>
      </div>

      <AccountingToolbar
        period={period}
        preset={preset}
        onPresetChange={setPreset}
        customStart={customStart}
        customEnd={customEnd}
        onCustomStartChange={setCustomStart}
        onCustomEndChange={setCustomEnd}
        compareMoM={compareMoM}
        onCompareMoMChange={setCompareMoM}
        compareYoY={compareYoY}
        onCompareYoYChange={setCompareYoY}
        onToggleExport={() => setExportOpen((v) => !v)}
        exportOpen={exportOpen}
      />

      {exportOpen && <SalesJournalExport />}

      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-3">
          <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0" />
          <p className="text-sm text-red-700">Erreur : {error}</p>
        </div>
      )}

      <div className="flex items-center gap-1 mb-6 border-b border-gray-200 overflow-x-auto">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                active ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => <div key={i} className="h-28 bg-gray-100 rounded-lg animate-pulse" />)}
          </div>
          <div className="h-80 bg-gray-100 rounded-lg animate-pulse" />
          <div className="h-64 bg-gray-100 rounded-lg animate-pulse" />
        </div>
      ) : (
        <>
          {activeTab === 'global' && <DashboardGlobalTab data={data} period={period} />}
          {activeTab === 'b2c' && <B2CTab data={data} period={period} />}
          {activeTab === 'b2b' && <B2BTab data={data} period={period} />}
          {activeTab === 'lives' && <LivesTab data={data} period={period} />}
        </>
      )}
    </div>
  );
};

export default Accounting;
