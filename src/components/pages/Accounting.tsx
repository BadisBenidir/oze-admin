import React, { useMemo, useState } from 'react';
import { LayoutDashboard, Globe, Handshake, Gavel, AlertCircle, Landmark, Receipt, Banknote, Wallet, Percent } from 'lucide-react';
import { useAdminAuth } from '../../hooks/useAdminAuth';
import { useAccountingRawData } from '../../hooks/useAccountingRawData';
import { buildAccountingPeriod, PeriodPreset } from '../../utils/accountingPeriods';
import { AccountingToolbar } from './accounting/AccountingToolbar';
import { SalesJournalExport } from './accounting/SalesJournalExport';
import { InvoicesBulkExport } from './accounting/InvoicesBulkExport';
import { DashboardGlobalTab } from './accounting/DashboardGlobalTab';
import { B2CTab } from './accounting/B2CTab';
import { B2BTab } from './accounting/B2BTab';
import { LivesTab } from './accounting/LivesTab';
import { QontoTab } from './accounting/QontoTab';
import { ChargesTab } from './accounting/ChargesTab';
import { OtherRevenuesTab } from './accounting/OtherRevenuesTab';
import { AssociateAccountTab } from './accounting/AssociateAccountTab';
import { useExpenses } from '../../hooks/useExpenses';
import { VatTab } from './accounting/VatTab';
import { useVatSettings } from '../../utils/vat';
import { toHtData, toHtExpenses } from '../../utils/accountingCalc';

type AccountingTab = 'global' | 'b2c' | 'b2b' | 'lives' | 'other-revenues' | 'expenses' | 'associate' | 'vat' | 'qonto';

const TABS: { id: AccountingTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'global', label: 'Dashboard Global', icon: LayoutDashboard },
  { id: 'b2c', label: 'B2C (Site Web)', icon: Globe },
  { id: 'b2b', label: 'B2B (Revendeurs & Sourcing)', icon: Handshake },
  { id: 'lives', label: 'Lives', icon: Gavel },
  { id: 'other-revenues', label: 'Autres revenus', icon: Banknote },
  { id: 'expenses', label: 'Charges', icon: Receipt },
  { id: 'associate', label: 'Compte courant associé', icon: Wallet },
  { id: 'vat', label: 'TVA', icon: Percent },
  { id: 'qonto', label: 'Trésorerie Qonto', icon: Landmark },
];

const todayIso = () => new Date().toISOString().slice(0, 10);

/** Comptabilité & Finances — architecture entièrement revue autour d'une
 * période/comparaison globale (voir accountingPeriods.ts) et d'un unique
 * chargement de données (useAccountingRawData, fenêtre glissante de 25
 * mois) partagé par les 4 onglets : changer de période ou d'onglet ne
 * relance jamais de requête, tout est déjà en mémoire. Remplace
 * intégralement l'ancienne page (6 sous-onglets ad hoc, dont "Factures" non
 * fonctionnel faute d'edge function). Les dépenses (`expenses`) sont dans
 * l'onglet « Charges » (0274 / 0276 : import Qonto, frais Stripe, À vérifier)
 * et déduites de la marge du Dashboard Global (Résultat net). */
export const Accounting: React.FC = () => {
  const { isAdmin } = useAdminAuth();
  const { data, loading, error, refresh } = useAccountingRawData(isAdmin);
  // Charges (0274 / 0276) : onglet dédié + déduites de la marge du Dashboard
  // Global (Résultat net).
  const expensesApi = useExpenses(isAdmin);
  // TVA (0280) : à partir de la bascule, CA, marge et résultat en HT (prix
  // inchangés, désormais TTC) ; charges diminuées de la TVA déductible.
  const vat = useVatSettings();
  const htData = useMemo(() => toHtData(data, vat.settings), [data, vat.settings]);
  const htExpenses = useMemo(() => toHtExpenses(expensesApi.expenses, vat.settings), [expensesApi.expenses, vat.settings]);

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

      <InvoicesBulkExport period={period} />

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
          {activeTab === 'global' && <DashboardGlobalTab data={htData} period={period} expenses={htExpenses} vatSales={htData.vatSales} />}
          {activeTab === 'b2c' && <B2CTab data={htData} period={period} />}
          {activeTab === 'b2b' && <B2BTab data={htData} period={period} />}
          {activeTab === 'lives' && <LivesTab data={htData} period={period} />}
          {activeTab === 'other-revenues' && (
            <OtherRevenuesTab revenues={data.manualRevenues} period={period} onChanged={() => refresh(true)} />
          )}
          {activeTab === 'vat' && (
            <VatTab
              settings={vat.settings}
              onSettingsChanged={vat.refresh}
              vatSales={htData.vatSales}
              expenses={expensesApi.expenses}
            />
          )}
          {activeTab === 'associate' && (
            <AssociateAccountTab onOpenTab={setActiveTab} onExpensesChanged={expensesApi.refresh} />
          )}
          {activeTab === 'expenses' && (
            <ChargesTab
              expenses={expensesApi.expenses}
              period={period}
              createExpense={expensesApi.createExpense}
              updateExpense={expensesApi.updateExpense}
              deleteExpense={expensesApi.deleteExpense}
              refreshExpenses={expensesApi.refresh}
            />
          )}
          {activeTab === 'qonto' && <QontoTab data={data} />}
        </>
      )}
    </div>
  );
};

export default Accounting;
