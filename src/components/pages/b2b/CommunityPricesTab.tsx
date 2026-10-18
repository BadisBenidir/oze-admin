import React, { useMemo, useState } from 'react';
import { AlertCircle, CalendarClock, Trash2 } from 'lucide-react';
import { Card, CardContent } from '../../ui/Card';
import { supabase } from '../../../lib/supabase';
import { MEMBER_GROUPS } from '../../../config/memberGroups';
import {
  useCommunityGroupPrices,
  DEFAULT_GROUP_PRICES,
  formatMonthlyPrice,
  formatPriceDate,
} from '../../../hooks/useCommunityGroupPrices';
import type { ResellerContact } from '../../../hooks/useResellers';

/** 1er du mois suivant (date par défaut d'un changement de prix). */
const nextMonthStart = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + 1, 1).toLocaleDateString('en-CA');
};

/**
 * Onglet « Abonnements » d'une communauté partenaire (fiche partenaire,
 * admin) : prix mensuel en vigueur et à venir de chaque groupe d'accès,
 * programmation d'un changement de prix à une date — les membres du groupe
 * sont prévenus à leur connexion (CommunityPriceNotice, portail membre).
 */
export const CommunityPricesTab: React.FC<{ resellerId: string; contacts: ResellerContact[] }> = ({ resellerId, contacts }) => {
  const { rows, info, refresh } = useCommunityGroupPrices(resellerId);
  const [prices, setPrices] = useState<Record<number, string>>(() =>
    Object.fromEntries(Object.entries(DEFAULT_GROUP_PRICES).map(([g, p]) => [g, String(p).replace('.', ',')]))
  );
  const [selected, setSelected] = useState<Set<number>>(new Set([1, 2, 3, 4]));
  const [effectiveFrom, setEffectiveFrom] = useState(nextMonthStart);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const counts = useMemo(() => {
    const c: Record<number, number> = {};
    for (const m of contacts) if (!m.is_primary && m.member_group) c[m.member_group] = (c[m.member_group] || 0) + 1;
    return c;
  }, [contacts]);
  const unclassified = contacts.filter((m) => !m.is_primary && !m.member_group).length;

  const toggle = (g: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });

  const schedule = async () => {
    setError(null);
    setNotice(null);
    if (selected.size === 0) return setError('Coche au moins un groupe');
    if (!effectiveFrom) return setError('Choisis la date d\'application');
    const lines = [...selected].sort().map((g) => ({ g, price: Number((prices[g] || '').replace(',', '.')) }));
    const invalid = lines.find((l) => !Number.isFinite(l.price) || l.price < 0);
    if (invalid) return setError(`Prix invalide pour le groupe ${invalid.g}`);
    if (!confirm(`Programmer ces prix à partir du ${formatPriceDate(effectiveFrom)} ?\n\n${lines.map((l) => `Groupe ${l.g} : ${formatMonthlyPrice(l.price)}`).join('\n')}\n\nLes membres concernés en seront prévenus à leur prochaine connexion.`)) return;

    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { error: upsertError } = await supabase.from('community_group_prices').upsert(
      lines.map((l) => ({
        reseller_id: resellerId,
        member_group: l.g,
        monthly_price: Math.round(l.price * 100) / 100,
        effective_from: effectiveFrom,
        created_by: user?.id ?? null,
      })),
      { onConflict: 'reseller_id,member_group,effective_from' }
    );
    setSaving(false);
    if (upsertError) return setError(upsertError.message);
    setNotice(`Prix programmés à partir du ${formatPriceDate(effectiveFrom)}.`);
    refresh();
  };

  const removeRow = async (id: string) => {
    if (!confirm('Supprimer ce changement de prix programmé ?')) return;
    const { error: deleteError } = await supabase.from('community_group_prices').delete().eq('id', id);
    if (deleteError) setError(deleteError.message);
    refresh();
  };

  const today = new Date().toLocaleDateString('en-CA');
  const upcomingRows = rows.filter((r) => r.effective_from > today);
  const input = 'rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none';

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {MEMBER_GROUPS.map((g) => {
          const i = info[g.id];
          return (
            <Card key={g.id}>
              <CardContent className="p-4">
                <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-semibold ${g.className}`}>{g.label}</span>
                <p className="mt-2 text-xs text-gray-500">{counts[g.id] || 0} membre{(counts[g.id] || 0) > 1 ? 's' : ''}</p>
                <p className="mt-2 text-lg font-semibold text-gray-900">
                  {i.current ? formatMonthlyPrice(i.current.monthly_price) : <span className="text-sm font-normal text-gray-400">Aucun prix en vigueur</span>}
                </p>
                {i.upcoming && (
                  <p className="mt-1 text-xs text-amber-700">
                    {formatMonthlyPrice(i.upcoming.monthly_price)} à partir du {formatPriceDate(i.upcoming.effective_from)}
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
      {unclassified > 0 && (
        <p className="text-xs text-amber-700">
          {unclassified} membre{unclassified > 1 ? 's ne sont' : " n'est"} pas encore classé{unclassified > 1 ? 's' : ''} dans un groupe : aucun prix ne {unclassified > 1 ? 'leur' : 'lui'} sera annoncé.
        </p>
      )}

      <Card>
        <CardContent className="space-y-4 p-4">
          <div>
            <p className="flex items-center gap-2 text-sm font-semibold text-gray-900">
              <CalendarClock className="h-4 w-4 text-gray-400" /> Programmer un changement de prix
            </p>
            <p className="text-xs text-gray-500">
              Le nouveau prix s'applique à partir de la date choisie. Les membres du groupe sont prévenus à chaque connexion jusqu'à cette date.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {MEMBER_GROUPS.map((g) => (
              <label key={g.id} className={`flex items-center gap-3 rounded-lg border p-3 ${selected.has(g.id) ? 'border-gray-300' : 'border-gray-100 opacity-60'}`}>
                <input type="checkbox" checked={selected.has(g.id)} onChange={() => toggle(g.id)} className="h-4 w-4 accent-gray-900" />
                <span className="min-w-0 flex-1 text-sm text-gray-800">{g.label}</span>
                <span className="relative">
                  <input
                    value={prices[g.id] ?? ''}
                    onChange={(e) => setPrices((p) => ({ ...p, [g.id]: e.target.value }))}
                    inputMode="decimal"
                    disabled={!selected.has(g.id)}
                    className={`${input} w-24 pr-7 text-right tabular-nums`}
                  />
                  <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-400">€</span>
                </span>
              </label>
            ))}
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
            <label className="flex items-center gap-2 text-sm text-gray-700">
              À partir du
              <input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} className={input} />
            </label>
            <button
              type="button"
              onClick={schedule}
              disabled={saving}
              className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
            >
              {saving ? 'Programmation…' : 'Programmer les prix'}
            </button>
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3">
              <AlertCircle className="h-4 w-4 flex-shrink-0 text-red-600" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}
          {notice && <p className="text-sm text-green-700">{notice}</p>}
        </CardContent>
      </Card>

      {upcomingRows.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <p className="mb-3 text-sm font-semibold text-gray-900">Changements programmés</p>
            <ul className="divide-y divide-gray-100">
              {upcomingRows.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="text-gray-800">
                    Groupe {r.member_group} → <strong>{formatMonthlyPrice(r.monthly_price)}</strong> à partir du {formatPriceDate(r.effective_from)}
                  </span>
                  <button onClick={() => removeRow(r.id)} className="p-1 text-gray-400 hover:text-red-600" title="Supprimer ce changement">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default CommunityPricesTab;
