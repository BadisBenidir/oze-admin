import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, ChevronDown, ChevronRight, Plus, RefreshCw, Tag, Trash2, TrendingUp, Users, X } from 'lucide-react';
import { Card, CardContent } from '../../ui/Card';
import { Badge } from '../../ui/Badge';
import { supabase } from '../../../lib/supabase';
import { invokeEdgeFunction } from '../../../utils/invokeEdgeFunction';

/**
 * Codes promo des abonnements Club B2B (page « Codes promo Club »), gérés ici
 * (table club_promo_codes, 0192) et saisis par le client sur la page
 * d'inscription. Membres et CA par code : factures d'abonnement enregistrées
 * (b2b_subscription_payments.promo_code, 0191).
 */

type Plan = 'drops' | 'revendeur';

interface ClubPromoCode {
  id: string;
  code: string;
  discount_type: 'percentage' | 'fixed_amount';
  discount_value: number;
  duration: 'once' | 'repeating' | 'forever';
  duration_months: number | null;
  plans: Plan[];
  max_uses: number | null;
  valid_until: string | null;
  status: 'active' | 'inactive';
  created_at: string;
}

interface PaymentRow {
  promo_code: string | null;
  reseller_id: string | null;
  stripe_customer_id: string | null;
  amount: number;
  discount_amount: number;
  paid_at: string;
  reseller: { company_name: string | null; contact_email: string | null } | null;
}

interface MemberStat {
  key: string;
  name: string;
  email: string | null;
  payments: number;
  revenue: number;
  discount: number;
  firstUse: string;
}

interface CodeStats {
  members: MemberStat[];
  revenue: number;
  discount: number;
}

const EUR = (n: number) => n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
const shortDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const PLAN_LABELS: Record<Plan, string> = { drops: 'Pass Drops', revendeur: 'Pass Revendeur' };

const discountLabel = (c: Pick<ClubPromoCode, 'discount_type' | 'discount_value' | 'duration' | 'duration_months'>): string => {
  const amount = c.discount_type === 'percentage' ? `-${Number(c.discount_value)} %` : `-${EUR(Number(c.discount_value))}`;
  const duration = c.duration === 'forever' ? 'à vie' : c.duration === 'once' ? '1er mois' : `${c.duration_months || 1} mois`;
  return `${amount} · ${duration}`;
};

const EMPTY_FORM = {
  code: '',
  discount_type: 'percentage' as ClubPromoCode['discount_type'],
  discount_value: '',
  duration: 'once' as ClubPromoCode['duration'],
  duration_months: '3',
  plans: ['drops', 'revendeur'] as Plan[],
  max_uses: '',
  valid_until: '',
};

const CreateCodeModal: React.FC<{ onClose: () => void; onCreated: () => void }> = ({ onClose, onCreated }) => {
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const code = form.code.trim().toUpperCase();
    const value = Number(form.discount_value.replace(',', '.'));
    if (!/^[A-Z0-9_-]{3,30}$/.test(code)) return setError('Code : 3 à 30 caractères, lettres, chiffres, - ou _');
    if (!value || value <= 0) return setError('Indique le montant de la remise');
    if (form.discount_type === 'percentage' && value > 100) return setError('Un pourcentage ne peut pas dépasser 100 %');
    if (form.plans.length === 0) return setError('Choisis au moins un pass');
    const months = Number(form.duration_months);
    if (form.duration === 'repeating' && (!months || months < 1 || months > 36)) return setError('Durée : entre 1 et 36 mois');

    setSaving(true);
    const { data: userData } = await supabase.auth.getUser();
    const { error: insertError } = await supabase.from('club_promo_codes').insert({
      code,
      discount_type: form.discount_type,
      discount_value: value,
      duration: form.duration,
      duration_months: form.duration === 'repeating' ? months : null,
      plans: form.plans,
      max_uses: form.max_uses ? Number(form.max_uses) : null,
      valid_until: form.valid_until ? new Date(`${form.valid_until}T23:59:59`).toISOString() : null,
      created_by: userData?.user?.id ?? null,
    });
    setSaving(false);
    if (insertError) {
      setError(insertError.code === '23505' ? 'Ce code existe déjà' : insertError.message);
      return;
    }
    onCreated();
    onClose();
  };

  const input = 'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none';

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black bg-opacity-50" onClick={onClose} />
      <div className="flex min-h-full items-center justify-center p-4">
        <form onSubmit={submit} className="relative w-full max-w-lg rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between border-b border-gray-100 p-5">
            <h3 className="text-base font-semibold text-gray-900">Nouveau code promo Club</h3>
            <button type="button" onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:text-gray-600">
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="space-y-4 p-5">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Code</label>
              <input
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                placeholder="BIENVENUE20"
                className={`${input} font-mono uppercase`}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Type de remise</label>
                <select
                  value={form.discount_type}
                  onChange={(e) => setForm({ ...form, discount_type: e.target.value as ClubPromoCode['discount_type'] })}
                  className={`${input} bg-white`}
                >
                  <option value="percentage">Pourcentage (%)</option>
                  <option value="fixed_amount">Montant fixe (€)</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">
                  Remise {form.discount_type === 'percentage' ? '(%)' : '(€)'}
                </label>
                <input
                  value={form.discount_value}
                  onChange={(e) => setForm({ ...form, discount_value: e.target.value })}
                  inputMode="decimal"
                  placeholder={form.discount_type === 'percentage' ? '20' : '10'}
                  className={input}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Durée de la remise</label>
                <select
                  value={form.duration}
                  onChange={(e) => setForm({ ...form, duration: e.target.value as ClubPromoCode['duration'] })}
                  className={`${input} bg-white`}
                >
                  <option value="once">Premier mois</option>
                  <option value="repeating">Plusieurs mois</option>
                  <option value="forever">À vie</option>
                </select>
              </div>
              {form.duration === 'repeating' && (
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Nombre de mois</label>
                  <input
                    value={form.duration_months}
                    onChange={(e) => setForm({ ...form, duration_months: e.target.value })}
                    inputMode="numeric"
                    className={input}
                  />
                </div>
              )}
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Valable pour</label>
              <div className="flex gap-4">
                {(['drops', 'revendeur'] as Plan[]).map((p) => (
                  <label key={p} className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={form.plans.includes(p)}
                      onChange={() =>
                        setForm({ ...form, plans: form.plans.includes(p) ? form.plans.filter((x) => x !== p) : [...form.plans, p] })
                      }
                      className="h-4 w-4 accent-gray-900"
                    />
                    {PLAN_LABELS[p]}
                  </label>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Utilisations max. (facultatif)</label>
                <input
                  value={form.max_uses}
                  onChange={(e) => setForm({ ...form, max_uses: e.target.value.replace(/\D/g, '') })}
                  inputMode="numeric"
                  placeholder="Illimité"
                  className={input}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Valable jusqu'au (facultatif)</label>
                <input
                  type="date"
                  value={form.valid_until}
                  onChange={(e) => setForm({ ...form, valid_until: e.target.value })}
                  className={input}
                />
              </div>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
          </div>
          <div className="flex justify-end gap-3 p-5 pt-0">
            <button type="button" onClick={onClose} className="rounded-lg bg-gray-100 px-4 py-2 text-sm text-gray-700 hover:bg-gray-200">
              Annuler
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
            >
              {saving ? 'Création…' : 'Créer le code'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export const SubscriptionPromoCodes: React.FC = () => {
  const [codes, setCodes] = useState<ClubPromoCode[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [codesRes, paymentsRes] = await Promise.all([
      supabase.from('club_promo_codes').select('*').order('created_at', { ascending: false }),
      supabase
        .from('b2b_subscription_payments')
        .select('promo_code, reseller_id, stripe_customer_id, amount, discount_amount, paid_at, reseller:resellers(company_name, contact_email)')
        .not('promo_code', 'is', null),
    ]);
    if (codesRes.error) setError(codesRes.error.message);
    else setCodes((codesRes.data || []) as ClubPromoCode[]);
    if (paymentsRes.error) setError(paymentsRes.error.message);
    else setPayments((paymentsRes.data || []) as unknown as PaymentRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const statsByCode = useMemo(() => {
    const map = new Map<string, CodeStats & { memberMap: Map<string, MemberStat> }>();
    for (const p of payments) {
      if (!p.promo_code) continue;
      const code = p.promo_code.toUpperCase();
      if (!map.has(code)) map.set(code, { members: [], revenue: 0, discount: 0, memberMap: new Map() });
      const s = map.get(code)!;
      const amount = Number(p.amount) || 0;
      const discount = Number(p.discount_amount) || 0;
      s.revenue += amount;
      s.discount += discount;
      const key = p.reseller_id || p.stripe_customer_id || 'inconnu';
      const m = s.memberMap.get(key);
      if (m) {
        m.payments += 1;
        m.revenue += amount;
        m.discount += discount;
        if (p.paid_at < m.firstUse) m.firstUse = p.paid_at;
      } else {
        s.memberMap.set(key, {
          key,
          name: p.reseller?.company_name || 'Compte inconnu',
          email: p.reseller?.contact_email || null,
          payments: 1,
          revenue: amount,
          discount,
          firstUse: p.paid_at,
        });
      }
    }
    const result = new Map<string, CodeStats>();
    for (const [code, s] of map) {
      result.set(code, { revenue: s.revenue, discount: s.discount, members: [...s.memberMap.values()].sort((a, b) => b.firstUse.localeCompare(a.firstUse)) });
    }
    return result;
  }, [payments]);

  const totals = useMemo(() => {
    const members = new Set(payments.map((p) => p.reseller_id || p.stripe_customer_id));
    return {
      activeCodes: codes.filter((c) => c.status === 'active').length,
      members: members.size,
      revenue: payments.reduce((s, p) => s + (Number(p.amount) || 0), 0),
      discount: payments.reduce((s, p) => s + (Number(p.discount_amount) || 0), 0),
    };
  }, [codes, payments]);

  const toggleStatus = async (c: ClubPromoCode) => {
    setBusyId(c.id);
    const { error: err } = await supabase
      .from('club_promo_codes')
      .update({ status: c.status === 'active' ? 'inactive' : 'active' })
      .eq('id', c.id);
    setBusyId(null);
    if (err) setError(err.message);
    else load();
  };

  const remove = async (c: ClubPromoCode) => {
    if (!window.confirm(`Supprimer le code ${c.code} ? Les abonnés qui l'ont déjà utilisé gardent leur remise.`)) return;
    setBusyId(c.id);
    const { error: err } = await supabase.from('club_promo_codes').delete().eq('id', c.id);
    setBusyId(null);
    if (err) setError(err.message);
    else load();
  };

  const sync = async () => {
    setSyncing(true);
    setSyncMessage(null);
    const { data, error: err } = await invokeEdgeFunction<{ recorded: number }>('sync-subscription-payments', {});
    setSyncing(false);
    setSyncMessage(err ? `Échec : ${err}` : `${data?.recorded ?? 0} facture(s) d'abonnement relue(s).`);
    if (!err) load();
  };

  return (
    <div className="p-4 md:p-6">
      <div className="mb-6 flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Codes promo Club B2B</h3>
          <p className="text-sm text-gray-500">Codes à saisir sur la page d'inscription au Pass Drops et au Pass Revendeur</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={sync}
            disabled={syncing}
            title="Relit les factures d'abonnement pour mettre à jour les statistiques"
            className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} /> Actualiser les stats
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800"
          >
            <Plus className="h-4 w-4" /> Créer un code
          </button>
        </div>
      </div>

      {syncMessage && <p className="mb-4 text-sm text-gray-600">{syncMessage}</p>}
      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 flex-shrink-0" /> {error}
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { icon: Tag, label: 'Codes actifs', value: String(totals.activeCodes) },
          { icon: Users, label: 'Membres avec un code', value: String(totals.members) },
          { icon: TrendingUp, label: 'CA encaissé via codes', value: EUR(totals.revenue) },
          { icon: Tag, label: 'Remises accordées', value: EUR(totals.discount) },
        ].map(({ icon: Icon, label, value }) => (
          <Card key={label}>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-xs font-medium text-gray-500">
                <Icon className="h-4 w-4 text-gray-400" /> {label}
              </div>
              <p className="mt-2 text-2xl font-semibold tabular-nums text-gray-900">{loading ? '…' : value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs font-medium text-gray-500">
                  <th className="px-4 py-3">Code</th>
                  <th className="px-4 py-3">Remise</th>
                  <th className="px-4 py-3">Pass</th>
                  <th className="px-4 py-3">Statut</th>
                  <th className="px-4 py-3 text-right">Membres</th>
                  <th className="px-4 py-3 text-right">CA encaissé</th>
                  <th className="px-4 py-3 text-right">Remises</th>
                  <th className="px-4 py-3">Expire</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={9} className="px-4 py-8 text-center text-sm text-gray-400">Chargement…</td></tr>
                ) : codes.length === 0 ? (
                  <tr><td colSpan={9} className="px-4 py-8 text-center text-sm text-gray-500">Aucun code promo. Clique sur « Créer un code ».</td></tr>
                ) : (
                  codes.map((c) => {
                    const stats = statsByCode.get(c.code.toUpperCase()) || { members: [], revenue: 0, discount: 0 };
                    const open = expanded === c.id;
                    const expired = Boolean(c.valid_until && new Date(c.valid_until).getTime() < Date.now());
                    const full = Boolean(c.max_uses && stats.members.length >= c.max_uses);
                    return (
                      <React.Fragment key={c.id}>
                        <tr onClick={() => setExpanded(open ? null : c.id)} className="cursor-pointer border-b border-gray-50 text-sm hover:bg-gray-50">
                          <td className="px-4 py-3 font-mono font-medium text-gray-900">
                            <span className="inline-flex items-center gap-1.5">
                              {open ? <ChevronDown className="h-3.5 w-3.5 text-gray-400" /> : <ChevronRight className="h-3.5 w-3.5 text-gray-400" />}
                              {c.code}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-gray-700">{discountLabel(c)}</td>
                          <td className="px-4 py-3 text-xs text-gray-600">
                            {c.plans.length === 2 ? 'Tous' : c.plans.map((p) => PLAN_LABELS[p]).join(', ')}
                          </td>
                          <td className="px-4 py-3">
                            {c.status === 'inactive' ? (
                              <Badge variant="default">Désactivé</Badge>
                            ) : expired ? (
                              <Badge variant="warning">Expiré</Badge>
                            ) : full ? (
                              <Badge variant="warning">Limite atteinte</Badge>
                            ) : (
                              <Badge variant="success">Actif</Badge>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right font-medium tabular-nums text-gray-900">
                            {stats.members.length}
                            {c.max_uses ? <span className="font-normal text-gray-400"> / {c.max_uses}</span> : null}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-gray-900">{EUR(stats.revenue)}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-gray-500">{EUR(stats.discount)}</td>
                          <td className="px-4 py-3 text-gray-500">{shortDate(c.valid_until)}</td>
                          <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                            <div className="inline-flex items-center gap-1">
                              <button
                                onClick={() => toggleStatus(c)}
                                disabled={busyId === c.id}
                                className="rounded-lg px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 disabled:opacity-50"
                              >
                                {c.status === 'active' ? 'Désactiver' : 'Activer'}
                              </button>
                              <button
                                onClick={() => remove(c)}
                                disabled={busyId === c.id}
                                title="Supprimer"
                                className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                        {open && (
                          <tr className="border-b border-gray-100 bg-gray-50/60">
                            <td colSpan={9} className="px-4 py-3">
                              {stats.members.length === 0 ? (
                                <p className="text-sm text-gray-500">Aucun membre n'a encore payé avec ce code.</p>
                              ) : (
                                <table className="w-full text-sm">
                                  <thead>
                                    <tr className="text-left text-xs text-gray-500">
                                      <th className="py-1.5 pr-4 font-medium">Membre</th>
                                      <th className="py-1.5 pr-4 font-medium">Depuis le</th>
                                      <th className="py-1.5 pr-4 text-right font-medium">Paiements</th>
                                      <th className="py-1.5 pr-4 text-right font-medium">CA encaissé</th>
                                      <th className="py-1.5 text-right font-medium">Remise</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {stats.members.map((m) => (
                                      <tr key={m.key} className="border-t border-gray-100">
                                        <td className="py-1.5 pr-4">
                                          <span className="font-medium text-gray-900">{m.name}</span>
                                          {m.email && <span className="ml-2 text-xs text-gray-500">{m.email}</span>}
                                        </td>
                                        <td className="py-1.5 pr-4 text-gray-600">{shortDate(m.firstUse)}</td>
                                        <td className="py-1.5 pr-4 text-right tabular-nums text-gray-700">{m.payments}</td>
                                        <td className="py-1.5 pr-4 text-right tabular-nums text-gray-900">{EUR(m.revenue)}</td>
                                        <td className="py-1.5 text-right tabular-nums text-gray-500">{EUR(m.discount)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
      <p className="mt-3 text-xs text-gray-400">
        « Membres » et « CA » : abonnés ayant payé au moins une échéance avec le code. Les statistiques se mettent à jour à
        chaque paiement ; « Actualiser les stats » relit tout l'historique.
      </p>

      {showCreate && <CreateCodeModal onClose={() => setShowCreate(false)} onCreated={load} />}
    </div>
  );
};

export default SubscriptionPromoCodes;
