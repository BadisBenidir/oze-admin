import React from 'react';
import { LucideIcon, TrendingUp, TrendingDown } from 'lucide-react';
import { Card, CardContent } from '../../ui/Card';

interface DeltaProps {
  value: number | null;
  suffix: string;
}

const Delta: React.FC<DeltaProps> = ({ value, suffix }) => {
  if (value === null || !Number.isFinite(value)) return null;
  const positive = value >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-semibold ${positive ? 'text-green-600' : 'text-red-600'}`}>
      {positive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {positive ? '+' : ''}{value.toFixed(1)}% {suffix}
    </span>
  );
};

interface AccountingKpiCardProps {
  label: string;
  value: string;
  icon: LucideIcon;
  hint?: string;
  tone?: 'default' | 'green' | 'red';
  deltaMoM?: number | null;
  deltaYoY?: number | null;
}

/** Carte métrique standard des 4 onglets Comptabilité & Finances — valeur +
 * variation(s) vs M-1/N-1 (voir percentChange, accountingPeriods.ts), null
 * si la période de référence n'a aucune activité (rien de significatif à
 * comparer, pas de division par zéro déguisée en "+∞%"). */
export const AccountingKpiCard: React.FC<AccountingKpiCardProps> = ({ label, value, icon: Icon, hint, tone = 'default', deltaMoM, deltaYoY }) => (
  <Card>
    <CardContent className="p-4 md:p-5">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-600">{label}</p>
          <p className={`text-xl md:text-2xl font-bold mt-0.5 ${tone === 'red' ? 'text-red-600' : tone === 'green' ? 'text-green-600' : 'text-gray-900'}`}>
            {value}
          </p>
          {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
          {(deltaMoM !== undefined || deltaYoY !== undefined) && (
            <div className="flex items-center gap-3 mt-2 flex-wrap">
              <Delta value={deltaMoM ?? null} suffix="vs M-1" />
              <Delta value={deltaYoY ?? null} suffix="vs N-1" />
            </div>
          )}
        </div>
        <div className={`h-10 w-10 md:h-11 md:w-11 rounded-lg flex items-center justify-center flex-shrink-0 ${
          tone === 'red' ? 'bg-red-50' : tone === 'green' ? 'bg-green-50' : 'bg-gray-50'
        }`}>
          <Icon className={`h-5 w-5 md:h-6 md:w-6 ${tone === 'red' ? 'text-red-600' : tone === 'green' ? 'text-green-600' : 'text-gray-600'}`} />
        </div>
      </div>
    </CardContent>
  </Card>
);

export default AccountingKpiCard;
