import React, { useMemo, useState } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { Radio, Users, Building2 } from 'lucide-react';
import { Card, CardContent, CardHeader } from '../ui/Card';
import { AccountingKpiCard } from './accounting/AccountingKpiCard';
import { useAdminAuth } from '../../hooks/useAdminAuth';
import { useB2BTraffic } from '../../hooks/useB2BTraffic';

/** Formate "depuis Xmin"/"depuis Xh" à partir d'un ISO online_at — recalculé
 * à chaque rendu plutôt qu'un vrai minuteur, suffisant pour un dashboard
 * admin déjà rafraîchi en temps réel par les événements Presence. */
const sinceLabel = (isoDate: string): string => {
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const minutes = Math.max(0, Math.floor(diffMs / 60000));
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `depuis ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `depuis ${hours} h${minutes % 60 ? ` ${minutes % 60}` : ''}`;
};

const dateLabel = (dateKey: string): string => {
  const d = new Date(`${dateKey}T00:00:00`);
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
};

export const B2BTraffic: React.FC = () => {
  const { isAdmin } = useAdminAuth();
  const [historyDays, setHistoryDays] = useState<14 | 30>(30);
  const { onlineResellers, uniqueToday, dailyHistory, loading } = useB2BTraffic(isAdmin, historyDays);

  const chartData = useMemo(() => dailyHistory.map((d) => ({ ...d, label: dateLabel(d.date) })), [dailyHistory]);
  const averageDaily = useMemo(
    () => (dailyHistory.length > 0 ? dailyHistory.reduce((s, d) => s + d.count, 0) / dailyHistory.length : 0),
    [dailyHistory]
  );

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-gray-900">Statistiques B2B</h3>
        <p className="text-sm text-gray-500">Activité en temps réel et fréquentation du portail revendeur</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4 md:p-5">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
                  </span>
                  <p className="text-sm font-medium text-gray-600">En ligne en temps réel</p>
                </div>
                <p className="text-xl md:text-2xl font-bold mt-1.5 text-gray-900">
                  {onlineResellers.length} revendeur{onlineResellers.length > 1 ? 's' : ''}
                </p>
              </div>
              <div className="h-10 w-10 md:h-11 md:w-11 rounded-lg bg-green-50 flex items-center justify-center flex-shrink-0">
                <Radio className="h-5 w-5 md:h-6 md:w-6 text-green-600" />
              </div>
            </div>
          </CardContent>
        </Card>
        <AccountingKpiCard label="Visiteurs uniques aujourd'hui" value={String(uniqueToday)} icon={Users} tone="default" />
        <AccountingKpiCard
          label={`Moyenne quotidienne (${historyDays} j)`}
          value={averageDaily.toFixed(1)}
          icon={Building2}
        />
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-gray-900">Revendeurs connectés maintenant</h3>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {onlineResellers.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-8">Aucun revendeur connecté pour le moment.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left py-2.5 px-4 md:px-6 font-medium text-gray-500 text-xs">Nom</th>
                    <th className="text-left py-2.5 px-4 md:px-6 font-medium text-gray-500 text-xs">Société</th>
                    <th className="text-left py-2.5 px-4 md:px-6 font-medium text-gray-500 text-xs">Connecté</th>
                  </tr>
                </thead>
                <tbody>
                  {onlineResellers.map((r) => (
                    <tr key={r.user_id} className="border-b border-gray-50 last:border-b-0">
                      <td className="py-2.5 px-4 md:px-6 text-sm">
                        <p className="font-medium text-gray-900">{r.first_name} {r.last_name}</p>
                        <p className="text-xs text-gray-400">{r.email}</p>
                      </td>
                      <td className="py-2.5 px-4 md:px-6 text-sm text-gray-600">{r.company_name || '—'}</td>
                      <td className="py-2.5 px-4 md:px-6 text-sm text-gray-500">{sinceLabel(r.online_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-gray-900">Visiteurs uniques par jour</h3>
            <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
              {([14, 30] as const).map((d) => (
                <button
                  key={d}
                  onClick={() => setHistoryDays(d)}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                    historyDays === d ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {d} jours
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="h-64 bg-gray-100 rounded-lg animate-pulse" />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={historyDays === 30 ? 2 : 0} />
                <YAxis tick={{ fontSize: 12 }} width={30} allowDecimals={false} />
                <Tooltip formatter={(v: any) => [`${v} visiteur${Number(v) > 1 ? 's' : ''}`, 'Uniques']} />
                <Bar dataKey="count" name="Visiteurs uniques" fill="#7c3aed" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default B2BTraffic;
