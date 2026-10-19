import React, { useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Copy, Download, Layers, Plus, Trash2, X } from 'lucide-react';
import { Card, CardContent } from '../../ui/Card';
import { Badge } from '../../ui/Badge';
import { supabase } from '../../../lib/supabase';

/**
 * Groupes de codes promo Club (club_promo_code_groups, 0218) : un titre, les
 * conditions d'une remise, et autant de codes individuels que voulu (lignes
 * club_promo_codes avec group_id), chacun à donner à une personne. Les codes
 * reprennent les conditions du groupe ; modifier ou désactiver le groupe
 * s'applique à tous ses codes.
 */

type Plan = 'drops' | 'revendeur';

export interface PromoCodeGroup {
  id: string;
  title: string;
  discount_type: 'percentage' | 'fixed_amount';
  discount_value: number;
  duration: 'once' | 'repeating' | 'forever';
  duration_months: number | null;
  plans: Plan[];
  uses_per_code: number | null;
  valid_until: string | null;
  status: 'active' | 'inactive';
  partner_name: string | null;
  created_at: string;
}

export interface GroupCode {
  id: string;
  code: string;
  status: 'active' | 'inactive';
  group_id: string | null;
  created_at: string;
}

interface CodeUse {
  members: { key: string; name: string; email: string | null }[];
  revenue: number;
  discount: number;
}

const EUR = (n: number) => n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
const PLAN_LABELS: Record<Plan, string> = { drops: 'Pass Drops', revendeur: 'Pass Revendeur' };
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const discountLabel = (g: Pick<PromoCodeGroup, 'discount_type' | 'discount_value' | 'duration' | 'duration_months'>) => {
  const amount = g.discount_type === 'percentage' ? `-${Number(g.discount_value)} %` : `-${EUR(Number(g.discount_value))}`;
  const duration = g.duration === 'forever' ? 'à vie' : g.duration === 'once' ? '1er mois' : `${g.duration_months || 1} mois`;
  return `${amount} · ${duration}`;
};

/** Préfixe des codes à partir du titre : lettres et chiffres, 10 caractères max. */
const prefixFrom = (title: string) =>
  title.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);

const randomSuffix = (length = 6) => {
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
};

/** Conditions du groupe recopiées sur chacun de ses codes. */
const codeConditions = (g: Omit<PromoCodeGroup, 'id' | 'title' | 'created_at'>) => ({
  discount_type: g.discount_type,
  discount_value: g.discount_value,
  duration: g.duration,
  duration_months: g.duration === 'repeating' ? g.duration_months : null,
  plans: g.plans,
  max_uses: g.uses_per_code || null,
  valid_until: g.valid_until,
  status: g.status,
  partner_name: g.partner_name,
});

/** Génère `count` codes du groupe (PRÉFIXE-XXXXXX), en réessayant les rares doublons. */
const generateCodes = async (group: PromoCodeGroup, prefix: string, count: number): Promise<string | null> => {
  const { data: userData } = await supabase.auth.getUser();
  let remaining = count;
  for (let attempt = 0; attempt < 5 && remaining > 0; attempt++) {
    const codes = new Set<string>();
    while (codes.size < remaining) codes.add(`${prefix ? `${prefix}-` : ''}${randomSuffix()}`);
    const rows = [...codes].map((code) => ({
      code,
      group_id: group.id,
      created_by: userData?.user?.id ?? null,
      ...codeConditions(group),
    }));
    const { error } = await supabase.from('club_promo_codes').insert(rows);
    if (!error) return null;
    if (error.code !== '23505') return error.message;
    // Doublon : on insère un par un pour garder ceux qui passent.
    for (const row of rows) {
      const { error: oneError } = await supabase.from('club_promo_codes').insert(row);
      if (!oneError) remaining--;
      else if (oneError.code !== '23505') return oneError.message;
    }
  }
  return remaining > 0 ? `${remaining} code(s) n'ont pas pu être générés, réessaie.` : null;
};

const EMPTY_FORM = {
  title: '',
  partner_name: '',
  discount_type: 'percentage' as PromoCodeGroup['discount_type'],
  discount_value: '',
  duration: 'forever' as PromoCodeGroup['duration'],
  duration_months: '3',
  plans: ['drops', 'revendeur'] as Plan[],
  uses_per_code: '1',
  valid_until: '',
  count: '10',
  prefix: '',
};

const GroupModal: React.FC<{ editing?: PromoCodeGroup | null; onClose: () => void; onSaved: () => void }> = ({ editing, onClose, onSaved }) => {
  const [form, setForm] = useState(
    editing
      ? {
          ...EMPTY_FORM,
          title: editing.title,
          partner_name: editing.partner_name || '',
          discount_type: editing.discount_type,
          discount_value: String(Number(editing.discount_value)),
          duration: editing.duration,
          duration_months: String(editing.duration_months || 3),
          plans: editing.plans,
          uses_per_code: editing.uses_per_code ? String(editing.uses_per_code) : '',
          valid_until: editing.valid_until ? editing.valid_until.slice(0, 10) : '',
        }
      : EMPTY_FORM
  );
  const [prefixTouched, setPrefixTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const prefix = prefixTouched ? form.prefix : prefixFrom(form.title);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const value = Number(form.discount_value.replace(',', '.'));
    const months = Number(form.duration_months);
    const count = Number(form.count);
    if (!form.title.trim()) return setError('Donne un titre au groupe');
    if (!value || value <= 0) return setError('Indique le montant de la remise');
    if (form.discount_type === 'percentage' && value > 100) return setError('Un pourcentage ne peut pas dépasser 100 %');
    if (form.plans.length === 0) return setError('Choisis au moins un pass');
    if (form.duration === 'repeating' && (!months || months < 1 || months > 36)) return setError('Durée : entre 1 et 36 mois');
    if (!editing && (!count || count < 1 || count > 500)) return setError('Nombre de codes : entre 1 et 500');
    if (!editing && !/^[A-Z0-9]{0,10}$/.test(prefix)) return setError('Préfixe : 10 lettres ou chiffres maximum');

    const conditions = {
      title: form.title.trim(),
      partner_name: form.partner_name.trim() || null,
      discount_type: form.discount_type,
      discount_value: value,
      duration: form.duration,
      duration_months: form.duration === 'repeating' ? months : null,
      plans: form.plans,
      uses_per_code: form.uses_per_code ? Number(form.uses_per_code) : null,
      valid_until: form.valid_until ? new Date(`${form.valid_until}T23:59:59`).toISOString() : null,
    };

    setSaving(true);
    if (editing) {
      const { error: groupError } = await supabase.from('club_promo_code_groups').update(conditions).eq('id', editing.id);
      if (!groupError) {
        const { error: codesError } = await supabase
          .from('club_promo_codes')
          .update(codeConditions({ ...editing, ...conditions }))
          .eq('group_id', editing.id);
        if (codesError) setError(codesError.message);
      } else setError(groupError.message);
      setSaving(false);
      if (!groupError) {
        onSaved();
        onClose();
      }
      return;
    }

    const { data: userData } = await supabase.auth.getUser();
    const { data: group, error: insertError } = await supabase
      .from('club_promo_code_groups')
      .insert({ ...conditions, status: 'active', created_by: userData?.user?.id ?? null })
      .select('*')
      .single();
    if (insertError || !group) {
      setSaving(false);
      return setError(insertError?.message || 'Création impossible');
    }
    const genError = await generateCodes(group as PromoCodeGroup, prefix, count);
    setSaving(false);
    if (genError) setError(genError);
    onSaved();
    if (!genError) onClose();
  };

  const input = 'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none';

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black bg-opacity-50" onClick={onClose} />
      <div className="flex min-h-full items-center justify-center p-4">
        <form onSubmit={submit} className="relative w-full max-w-lg rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between border-b border-gray-100 p-5">
            <h3 className="text-base font-semibold text-gray-900">{editing ? `Modifier « ${editing.title} »` : 'Nouveau groupe de codes'}</h3>
            <button type="button" onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:text-gray-600">
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="space-y-4 p-5">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Titre</label>
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Ex. Ambassadeurs TikTok" className={input} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Partenaire (facultatif)</label>
              <input value={form.partner_name} onChange={(e) => setForm({ ...form, partner_name: e.target.value })} placeholder="Ex. Julia" className={input} />
              <p className="mt-1 text-xs text-gray-500">Le CA des abonnements souscrits avec ces codes lui est attribué en comptabilité.</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Type de remise</label>
                <select value={form.discount_type} onChange={(e) => setForm({ ...form, discount_type: e.target.value as PromoCodeGroup['discount_type'] })} className={`${input} bg-white`}>
                  <option value="percentage">Pourcentage (%)</option>
                  <option value="fixed_amount">Montant fixe (€)</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Remise {form.discount_type === 'percentage' ? '(%)' : '(€)'}</label>
                <input value={form.discount_value} onChange={(e) => setForm({ ...form, discount_value: e.target.value })} inputMode="decimal" placeholder="100" className={input} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Durée de la remise</label>
                <select value={form.duration} onChange={(e) => setForm({ ...form, duration: e.target.value as PromoCodeGroup['duration'] })} className={`${input} bg-white`}>
                  <option value="once">Premier mois</option>
                  <option value="repeating">Plusieurs mois</option>
                  <option value="forever">À vie</option>
                </select>
              </div>
              {form.duration === 'repeating' && (
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Nombre de mois</label>
                  <input value={form.duration_months} onChange={(e) => setForm({ ...form, duration_months: e.target.value })} inputMode="numeric" className={input} />
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
                      onChange={() => setForm({ ...form, plans: form.plans.includes(p) ? form.plans.filter((x) => x !== p) : [...form.plans, p] })}
                      className="h-4 w-4 accent-gray-900"
                    />
                    {PLAN_LABELS[p]}
                  </label>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Utilisations par code</label>
                <input value={form.uses_per_code} onChange={(e) => setForm({ ...form, uses_per_code: e.target.value.replace(/\D/g, '') })} inputMode="numeric" placeholder="Illimité" className={input} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Valable jusqu'au (facultatif)</label>
                <input type="date" value={form.valid_until} onChange={(e) => setForm({ ...form, valid_until: e.target.value })} className={input} />
              </div>
            </div>
            {!editing && (
              <div className="grid grid-cols-2 gap-3 rounded-lg border border-gray-100 bg-gray-50 p-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Nombre de codes</label>
                  <input value={form.count} onChange={(e) => setForm({ ...form, count: e.target.value.replace(/\D/g, '') })} inputMode="numeric" className={`${input} bg-white`} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Préfixe des codes</label>
                  <input
                    value={prefix}
                    onChange={(e) => {
                      setPrefixTouched(true);
                      setForm({ ...form, prefix: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10) });
                    }}
                    className={`${input} bg-white font-mono uppercase`}
                  />
                </div>
                <p className="col-span-2 text-xs text-gray-500">
                  Exemple : <span className="font-mono">{prefix ? `${prefix}-` : ''}7KQ2MX</span>. Tu pourras en générer d'autres plus tard.
                </p>
              </div>
            )}
            {editing && <p className="text-xs text-gray-500">Les nouvelles conditions s'appliquent à tous les codes du groupe, pour les prochaines inscriptions.</p>}
            {error && <p className="text-sm text-red-600">{error}</p>}
          </div>
          <div className="flex justify-end gap-3 p-5 pt-0">
            <button type="button" onClick={onClose} className="rounded-lg bg-gray-100 px-4 py-2 text-sm text-gray-700 hover:bg-gray-200">
              Annuler
            </button>
            <button type="submit" disabled={saving} className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50">
              {saving ? 'Enregistrement…' : editing ? 'Enregistrer' : 'Créer le groupe et les codes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export const PromoCodeGroups: React.FC<{
  groups: PromoCodeGroup[];
  codes: GroupCode[];
  usesByCode: Map<string, CodeUse>;
  onChanged: () => void;
}> = ({ groups, codes, usesByCode, onChanged }) => {
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<PromoCodeGroup | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'free' | 'used'>('all');

  const byGroup = useMemo(() => {
    const map = new Map<string, GroupCode[]>();
    for (const c of codes) if (c.group_id) map.set(c.group_id, [...(map.get(c.group_id) || []), c]);
    return map;
  }, [codes]);

  const groupStats = (groupId: string) => {
    const list = byGroup.get(groupId) || [];
    let used = 0;
    let members = 0;
    let revenue = 0;
    for (const c of list) {
      const u = usesByCode.get(c.code.toUpperCase());
      if (u && u.members.length) {
        used++;
        members += u.members.length;
        revenue += u.revenue;
      }
    }
    return { total: list.length, used, members, revenue };
  };

  const toggleStatus = async (g: PromoCodeGroup) => {
    setBusyId(g.id);
    const status = g.status === 'active' ? 'inactive' : 'active';
    const { error: err } = await supabase.from('club_promo_code_groups').update({ status }).eq('id', g.id);
    if (!err) await supabase.from('club_promo_codes').update({ status }).eq('group_id', g.id);
    setBusyId(null);
    if (err) setError(err.message);
    else onChanged();
  };

  const remove = async (g: PromoCodeGroup) => {
    if (!window.confirm(`Supprimer le groupe « ${g.title} » et tous ses codes ? Les abonnés qui en ont déjà utilisé un gardent leur remise.`)) return;
    setBusyId(g.id);
    const { error: err } = await supabase.from('club_promo_code_groups').delete().eq('id', g.id);
    setBusyId(null);
    if (err) setError(err.message);
    else onChanged();
  };

  const addCodes = async (g: PromoCodeGroup) => {
    const answer = window.prompt(`Combien de codes ajouter au groupe « ${g.title} » ?`, '10');
    const count = Number(answer);
    if (!answer || !count || count < 1 || count > 500) return;
    const existing = byGroup.get(g.id)?.[0]?.code || '';
    const prefix = existing.includes('-') ? existing.split('-').slice(0, -1).join('-') : prefixFrom(g.title);
    setBusyId(g.id);
    const err = await generateCodes(g, prefix, count);
    setBusyId(null);
    if (err) setError(err);
    onChanged();
  };

  const exportCsv = (g: PromoCodeGroup) => {
    const rows = (byGroup.get(g.id) || []).map((c) => {
      const u = usesByCode.get(c.code.toUpperCase());
      return [c.code, u?.members.length ? 'Utilisé' : 'Disponible', u?.members.map((m) => m.name).join(' / ') || ''];
    });
    const csv = [['Code', 'Statut', 'Utilisé par'], ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\n');
    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `codes-${prefixFrom(g.title) || 'groupe'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(code);
      setTimeout(() => setCopied((c) => (c === code ? null : c)), 1500);
    } catch {
      /* presse-papiers indisponible */
    }
  };

  return (
    <Card className="mb-6">
      <CardContent className="p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 p-4">
          <div>
            <p className="flex items-center gap-2 text-sm font-semibold text-gray-900">
              <Layers className="h-4 w-4 text-gray-400" /> Groupes de codes
            </p>
            <p className="text-xs text-gray-500">Un titre, une remise, et un code individuel par personne avec les mêmes avantages.</p>
          </div>
          <button onClick={() => setShowCreate(true)} className="flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800">
            <Plus className="h-4 w-4" /> Créer un groupe
          </button>
        </div>

        {error && <p className="border-b border-gray-100 px-4 py-2 text-sm text-red-600">{error}</p>}

        {groups.length === 0 ? (
          <p className="p-6 text-center text-sm text-gray-500">Aucun groupe. Crée-en un pour générer des codes individuels.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {groups.map((g) => {
              const s = groupStats(g.id);
              const open = expanded === g.id;
              const list = (byGroup.get(g.id) || []).filter((c) => {
                const used = Boolean(usesByCode.get(c.code.toUpperCase())?.members.length);
                return filter === 'all' || (filter === 'used' ? used : !used);
              });
              const expired = Boolean(g.valid_until && new Date(g.valid_until).getTime() < Date.now());
              return (
                <li key={g.id}>
                  <div onClick={() => setExpanded(open ? null : g.id)} className="flex cursor-pointer flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 hover:bg-gray-50">
                    <div className="flex min-w-[220px] flex-1 items-center gap-2">
                      {open ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronRight className="h-4 w-4 text-gray-400" />}
                      <div>
                        <p className="text-sm font-semibold text-gray-900">{g.title}</p>
                        <p className="text-xs text-gray-500">
                          {discountLabel(g)} · {g.plans.length === 2 ? 'Tous les pass' : g.plans.map((p) => PLAN_LABELS[p]).join(', ')}
                          {g.partner_name ? ` · ${g.partner_name}` : ''}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-semibold tabular-nums text-gray-900">{s.members}</p>
                      <p className="text-xs text-gray-500">personne{s.members > 1 ? 's' : ''}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium tabular-nums text-gray-900">{s.used} / {s.total}</p>
                      <p className="text-xs text-gray-500">codes utilisés</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium tabular-nums text-gray-900">{EUR(s.revenue)}</p>
                      <p className="text-xs text-gray-500">CA encaissé</p>
                    </div>
                    <div>
                      {g.status === 'inactive' ? <Badge variant="default">Désactivé</Badge> : expired ? <Badge variant="warning">Expiré</Badge> : <Badge variant="success">Actif</Badge>}
                    </div>
                    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => addCodes(g)} disabled={busyId === g.id} className="rounded-lg px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 disabled:opacity-50">
                        + Codes
                      </button>
                      <button onClick={() => exportCsv(g)} title="Exporter les codes (CSV)" className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700">
                        <Download className="h-4 w-4" />
                      </button>
                      <button onClick={() => setEditing(g)} className="rounded-lg px-2 py-1 text-xs text-gray-600 hover:bg-gray-100">
                        Modifier
                      </button>
                      <button onClick={() => toggleStatus(g)} disabled={busyId === g.id} className="rounded-lg px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 disabled:opacity-50">
                        {g.status === 'active' ? 'Désactiver' : 'Activer'}
                      </button>
                      <button onClick={() => remove(g)} disabled={busyId === g.id} title="Supprimer" className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  {open && (
                    <div className="border-t border-gray-100 bg-gray-50/60 px-4 py-3">
                      <div className="mb-3 flex gap-2">
                        {([['all', 'Tous'], ['free', 'Disponibles'], ['used', 'Utilisés']] as const).map(([id, label]) => (
                          <button
                            key={id}
                            onClick={() => setFilter(id)}
                            className={`rounded-full border px-3 py-1 text-xs font-medium ${filter === id ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 bg-white text-gray-600'}`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      {list.length === 0 ? (
                        <p className="text-sm text-gray-500">Aucun code.</p>
                      ) : (
                        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                          {list.map((c) => {
                            const u = usesByCode.get(c.code.toUpperCase());
                            const used = Boolean(u?.members.length);
                            return (
                              <div key={c.id} className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2">
                                <div className="min-w-0">
                                  <p className="font-mono text-sm font-medium text-gray-900">{c.code}</p>
                                  <p className={`truncate text-xs ${used ? 'text-green-700' : 'text-gray-400'}`}>
                                    {used ? `Utilisé par ${u!.members.map((m) => m.name).join(', ')}` : 'Disponible'}
                                  </p>
                                </div>
                                <button onClick={() => copy(c.code)} title="Copier le code" className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700">
                                  {copied === c.code ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>

      {showCreate && <GroupModal onClose={() => setShowCreate(false)} onSaved={onChanged} />}
      {editing && <GroupModal key={editing.id} editing={editing} onClose={() => setEditing(null)} onSaved={onChanged} />}
    </Card>
  );
};

export default PromoCodeGroups;
