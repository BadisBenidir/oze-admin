export type PeriodPreset = 'current-month' | 'previous-month' | 'current-quarter' | 'ytd' | 'custom';

export interface DateRange {
  start: Date;
  end: Date;
}

export interface AccountingPeriod {
  preset: PeriodPreset;
  range: DateRange;
  label: string;
  compareMoM: boolean;
  compareYoY: boolean;
  momRange: DateRange | null;
  yoyRange: DateRange | null;
}

const startOfDay = (d: Date) => { const c = new Date(d); c.setHours(0, 0, 0, 0); return c; };
const endOfDay = (d: Date) => { const c = new Date(d); c.setHours(23, 59, 59, 999); return c; };
const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
const endOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);

/** Décale une plage d'exactement un an (mêmes jour/mois, année -1) — pour la
 * comparaison N-1. Gère naïvement le 29 février (retombe sur le 28) : cas
 * marginal, sans conséquence pour un usage comptable mensuel/trimestriel. */
const shiftYears = (d: Date, years: number): Date => {
  const c = new Date(d);
  c.setFullYear(c.getFullYear() + years);
  return c;
};

/** Plage immédiatement précédente, de même durée (en jours) — pour la
 * comparaison M-1, générique quel que soit le preset choisi (mois civil,
 * trimestre, YTD ou plage personnalisée). */
const shiftByOwnLength = (range: DateRange): DateRange => {
  const spanMs = range.end.getTime() - range.start.getTime();
  return {
    start: new Date(range.start.getTime() - spanMs - 1),
    end: new Date(range.start.getTime() - 1),
  };
};

export const PERIOD_PRESET_LABELS: Record<PeriodPreset, string> = {
  'current-month': 'Mois en cours',
  'previous-month': 'Mois précédent',
  'current-quarter': 'Ce trimestre',
  ytd: "Année en cours (YTD)",
  custom: 'Plage personnalisée',
};

export const computeRangeForPreset = (preset: PeriodPreset, customStart?: string, customEnd?: string): DateRange => {
  const now = new Date();
  switch (preset) {
    case 'previous-month': {
      const prevMonthAnchor = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      return { start: startOfMonth(prevMonthAnchor), end: endOfMonth(prevMonthAnchor) };
    }
    case 'current-quarter': {
      const quarterStartMonth = Math.floor(now.getMonth() / 3) * 3;
      return { start: new Date(now.getFullYear(), quarterStartMonth, 1), end: endOfDay(now) };
    }
    case 'ytd':
      return { start: new Date(now.getFullYear(), 0, 1), end: endOfDay(now) };
    case 'custom':
      return {
        start: customStart ? startOfDay(new Date(customStart)) : startOfMonth(now),
        end: customEnd ? endOfDay(new Date(customEnd)) : endOfDay(now),
      };
    default:
      return { start: startOfMonth(now), end: endOfDay(now) };
  }
};

export const buildAccountingPeriod = (
  preset: PeriodPreset,
  compareMoM: boolean,
  compareYoY: boolean,
  customStart?: string,
  customEnd?: string
): AccountingPeriod => {
  const range = computeRangeForPreset(preset, customStart, customEnd);
  return {
    preset,
    range,
    label: PERIOD_PRESET_LABELS[preset],
    compareMoM,
    compareYoY,
    momRange: compareMoM ? shiftByOwnLength(range) : null,
    yoyRange: compareYoY ? { start: shiftYears(range.start, -1), end: shiftYears(range.end, -1) } : null,
  };
};

/** Fenêtre de récupération des données brutes : suffisamment large pour
 * couvrir la comparaison N-1 la plus ancienne possible (13 mois avant le
 * début de l'année en cours, pour un YTD comparé à N-1) et les 12 derniers
 * mois du graphique d'évolution du Dashboard Global. */
export const RAW_DATA_WINDOW_MONTHS = 25;

export const rawDataWindowStart = (): Date => {
  const now = new Date();
  return startOfMonth(new Date(now.getFullYear(), now.getMonth() - RAW_DATA_WINDOW_MONTHS, 1));
};

export const isWithinRange = (iso: string | null | undefined, range: DateRange): boolean => {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return t >= range.start.getTime() && t <= range.end.getTime();
};

export const formatRangeLabel = (range: DateRange): string =>
  `${range.start.toLocaleDateString('fr-FR')} → ${range.end.toLocaleDateString('fr-FR')}`;

export const monthKey = (iso: string): string => (iso || '').slice(0, 7);

export const monthKeyLabel = (ym: string): string => {
  const d = new Date(ym + '-01T00:00:00');
  return d.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' });
};

/** Variation en % entre une valeur courante et une valeur de référence —
 * null si la référence est nulle/zéro (rien de significatif à comparer). */
export const percentChange = (current: number, previous: number): number | null => {
  if (!previous) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
};
