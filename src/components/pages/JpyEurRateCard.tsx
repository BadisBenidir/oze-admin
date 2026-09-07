import React, { useState } from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { RefreshCw, JapaneseYen } from 'lucide-react';
import { Card, CardContent, CardHeader } from '../ui/Card';
import { useJpyEurRate } from '../../hooks/useJpyEurRate';

const RATE_COLOR = '#0ea5e9';

const formatDateLabel = (isoDate: string): string => {
  const d = new Date(isoDate);
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
};

/**
 * Historique du taux JPY -> EUR (jpy_eur_rates, 0113) : alimenté chaque jour
 * par pg_cron (edge function fetch-jpy-eur-rate) — le bouton "Rafraîchir"
 * ne fait que déclencher immédiatement le même appel, pour ne pas attendre
 * le prochain passage du job si le taux du jour manque encore. Consommé par
 * CreateProduct.tsx pour convertir un prix d'achat payé en yens.
 */
export const JpyEurRateCard: React.FC = () => {
  const { history, latest, loading, error, refreshing, refreshNow } = useJpyEurRate();
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const chartData = history.map((h) => ({ ...h, label: formatDateLabel(h.rate_date) }));

  const handleRefresh = async () => {
    setRefreshError(null);
    const result = await refreshNow();
    if (!result.success) setRefreshError(result.error || 'Échec de la récupération du taux');
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <JapaneseYen className="h-4 w-4 text-gray-400" />
            Taux de change JPY → EUR
          </h3>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            Rafraîchir
          </button>
        </div>
      </CardHeader>
      <CardContent>
        {refreshError && (
          <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-3">
            <p className="text-sm text-red-700">{refreshError}</p>
          </div>
        )}
        {loading ? (
          <div className="h-[220px] flex items-center justify-center text-sm text-gray-400">Chargement...</div>
        ) : error ? (
          <p className="text-sm text-red-600">{error}</p>
        ) : history.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-sm text-gray-500 mb-3">
              Aucun taux enregistré pour l'instant — le job automatique passe chaque jour à 6h (UTC).
            </p>
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50 text-sm"
            >
              {refreshing ? 'Récupération...' : 'Récupérer le taux maintenant'}
            </button>
          </div>
        ) : (
          <>
            {latest && (
              <div className="mb-4">
                <p className="text-2xl font-semibold text-gray-900 tabular-nums">
                  1 ¥ = {latest.rate.toFixed(6)} €
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Taux du {formatDateLabel(latest.rate_date)} — récupéré à{' '}
                  {new Date(latest.fetched_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}.
                  Ce taux reste appliqué pour toute création d'article aujourd'hui.
                </p>
              </div>
            )}
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                <YAxis
                  tick={{ fontSize: 12 }}
                  domain={['dataMin - 0.0001', 'dataMax + 0.0001']}
                  tickFormatter={(v: number) => v.toFixed(4)}
                  width={70}
                />
                <Tooltip formatter={(v) => [`${Number(v).toFixed(6)} €`, '1 ¥'] as [string, string]} labelFormatter={(l) => `Le ${l}`} />
                <Line type="monotone" dataKey="rate" stroke={RATE_COLOR} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default JpyEurRateCard;
