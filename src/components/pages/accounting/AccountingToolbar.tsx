import React from 'react';
import { Download, Calendar } from 'lucide-react';
import { PeriodPreset, PERIOD_PRESET_LABELS, formatRangeLabel, AccountingPeriod } from '../../../utils/accountingPeriods';

interface AccountingToolbarProps {
  period: AccountingPeriod;
  preset: PeriodPreset;
  onPresetChange: (preset: PeriodPreset) => void;
  customStart: string;
  customEnd: string;
  onCustomStartChange: (v: string) => void;
  onCustomEndChange: (v: string) => void;
  compareMoM: boolean;
  onCompareMoMChange: (v: boolean) => void;
  compareYoY: boolean;
  onCompareYoYChange: (v: boolean) => void;
  onToggleExport: () => void;
  exportOpen: boolean;
}

/** Barre d'outils globale de "Comptabilité & Finances" : sélection de
 * période + comparaisons, partagée par les 4 onglets (le changement de
 * période ne relance aucune requête — voir useAccountingRawData, tout est
 * déjà chargé et filtré en mémoire côté onglets). */
export const AccountingToolbar: React.FC<AccountingToolbarProps> = ({
  period, preset, onPresetChange, customStart, customEnd, onCustomStartChange, onCustomEndChange,
  compareMoM, onCompareMoMChange, compareYoY, onCompareYoYChange, onToggleExport, exportOpen,
}) => (
  <div className="bg-white border border-gray-200 rounded-lg p-4 mb-6 flex flex-wrap items-center gap-4">
    <div className="flex items-center gap-2">
      <Calendar className="h-4 w-4 text-gray-400 flex-shrink-0" />
      <select
        value={preset}
        onChange={(e) => onPresetChange(e.target.value as PeriodPreset)}
        className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-gray-400 bg-white"
      >
        {(Object.keys(PERIOD_PRESET_LABELS) as PeriodPreset[]).map((p) => (
          <option key={p} value={p}>{PERIOD_PRESET_LABELS[p]}</option>
        ))}
      </select>
    </div>

    {preset === 'custom' && (
      <div className="flex items-center gap-2">
        <input
          type="date"
          value={customStart}
          onChange={(e) => onCustomStartChange(e.target.value)}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-gray-400"
        />
        <span className="text-gray-400 text-sm">→</span>
        <input
          type="date"
          value={customEnd}
          onChange={(e) => onCustomEndChange(e.target.value)}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-gray-400"
        />
      </div>
    )}

    {preset !== 'custom' && (
      <span className="text-xs text-gray-400">{formatRangeLabel(period.range)}</span>
    )}

    <div className="flex items-center gap-4 ml-auto flex-wrap">
      <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer">
        <input
          type="checkbox"
          checked={compareMoM}
          onChange={(e) => onCompareMoMChange(e.target.checked)}
          className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-900"
        />
        Comparer au mois précédent (M-1)
      </label>
      <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer">
        <input
          type="checkbox"
          checked={compareYoY}
          onChange={(e) => onCompareYoYChange(e.target.checked)}
          className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-900"
        />
        Comparer à l'année précédente (N-1)
      </label>

      <button
        onClick={onToggleExport}
        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
          exportOpen ? 'bg-gray-800 text-white' : 'bg-gray-900 text-white hover:bg-gray-800'
        }`}
      >
        <Download className="h-4 w-4" />
        Export Comptable Excel
      </button>
    </div>
  </div>
);

export default AccountingToolbar;
