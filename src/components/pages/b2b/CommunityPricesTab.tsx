import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CalendarClock, Plus, Search, Trash2 } from 'lucide-react';
import { Card, CardContent } from '../../ui/Card';
import { supabase } from '../../../lib/supabase';
import { GROUP_COLORS } from '../../../config/memberGroups';
import { useMemberGroups } from '../../../hooks/useMemberGroups';
import {
  useCommunityGroupPrices,
  DEFAULT_GROUP_PRICES,
  formatMonthlyPrice,
  formatPriceDate,
} from '../../../hooks/useCommunityGroupPrices';
import type { ResellerContact } from '../../../hooks/useResellers';
import { CommunityOfferFeesCard } from './CommunityOfferFeesCard';

interface MemberSub {
  id: string;
  community_sub_status: string | null;
  community_sub_price: number | null;
  community_sub_current_period_end: string | null;
  community_sub_plan: string | null;
  free_access_until: string | null;
  total_paid: number;
}

const PAYING_STATUSES = ['active', 'trialing', 'past_due'];

const memberSubStatus = (sub: MemberSub | undefined): { label: string; className: string } => {
  const price = sub?.community_sub_price ? ` · ${formatMonthlyPrice(Number(sub.community_sub_price))}` : '';
  const plan = sub?.community_sub_plan === 'drops' ? ' (Pass Drops)' : '';
  switch (sub?.community_sub_status) {
    case 'active':
    case 'trialing':
      return { label: `Abonné${plan}${price}`, className: 'bg-green-50 text-green-700' };
    case 'past_due':
      return { label: `Paiement en retard${price}`, className: 'bg-red-50 text-red-700' };
    case 'canceled':
      return { label: 'Résilié', className: 'bg-gray-100 text-gray-600' };
  }
  if (sub?.free_access_until && new Date(sub.free_access_until) > new Date()) {
    return { label: `Accès offert jusqu'au ${new Date(sub.free_access_until).toLocaleDateString('fr-FR')}`, className: 'bg-teal-50 text-teal-700' };
  }
  return { label: 'Non abonné', className: 'bg-amber-50 text-amber-700' };
};

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
export const CommunityPricesTab: React.FC<{
  resellerId: string;
  contacts: ResellerContact[];
  onMemberGroupChanged?: (contactId: string, group: number | null) => void;
  onGroupsChanged?: () => void;
}> = ({ resellerId, contacts, onMemberGroupChanged, onGroupsChanged }) => {
  const { rows, info, refresh } = useCommunityGroupPrices(resellerId);
  const { groups: MEMBER_GROUPS, custom: customGroups, refresh: refreshGroups } = useMemberGroups(resellerId);
  const emptyInfo = { current: null, upcoming: null };
  const [prices, setPrices] = useState<Record<number, string>>(() =>
    Object.fromEntries(Object.entries(DEFAULT_GROUP_PRICES).map(([g, p]) => [g, String(p).replace('.', ',')]))
  );
  const [messages, setMessages] = useState<Record<number, string>>({});
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
  // Abonnement de chaque membre (0214, 0222) et total payé (0217, hors 300 €
  // de l'offre non encore reçus).
  const [subs, setSubs] = useState<Record<string, MemberSub>>({});
  useEffect(() => {
    Promise.all([
      supabase
        .from('reseller_contacts')
        .select('id, community_sub_status, community_sub_price, community_sub_current_period_end, community_sub_plan, free_access_until')
        .eq('reseller_id', resellerId),
      supabase.from('community_subscription_payments').select('contact_id, amount').eq('reseller_id', resellerId).eq('awaiting_payment', false),
    ]).then(([contactsRes, paymentsRes]) => {
      const paid: Record<string, number> = {};
      for (const p of (paymentsRes.data || []) as { contact_id: string | null; amount: number }[]) {
        if (p.contact_id) paid[p.contact_id] = (paid[p.contact_id] || 0) + Number(p.amount || 0);
      }
      const next: Record<string, MemberSub> = {};
      for (const r of (contactsRes.data || []) as Omit<MemberSub, 'total_paid'>[]) next[r.id] = { ...r, total_paid: paid[r.id] || 0 };
      setSubs(next);
    });
  }, [resellerId]);
  const paying = useMemo(() => {
    const c: Record<number, number> = {};
    for (const m of contacts) {
      if (!m.is_primary && m.member_group && PAYING_STATUSES.includes(subs[m.id]?.community_sub_status || '')) c[m.member_group] = (c[m.member_group] || 0) + 1;
    }
    return c;
  }, [contacts, subs]);
  // Groupe ouvert (détail des membres) ; 0 = membres non classés.
  const [openGroup, setOpenGroup] = useState<number | null>(null);
  const openMembers = useMemo(
    () =>
      openGroup === null
        ? []
        : contacts
            .filter((m) => !m.is_primary && (openGroup === 0 ? !m.member_group : m.member_group === openGroup))
            .sort((a, b) => `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`, 'fr')),
    [contacts, openGroup]
  );
  const unclassified = contacts.filter((m) => !m.is_primary && !m.member_group).length;

  // Groupe personnalisé (0236) : création / modification (nom, description, couleur).
  const [groupForm, setGroupForm] = useState<{ id: string | null; label: string; hint: string; color: string } | null>(null);
  const [groupSaving, setGroupSaving] = useState(false);
  const saveGroup = async () => {
    if (!groupForm) return;
    if (!groupForm.label.trim()) return alert('Donne un nom au groupe');
    setGroupSaving(true);
    const payload = { label: groupForm.label.trim(), hint: groupForm.hint.trim() || null, color: groupForm.color };
    let id = groupForm.id;
    let groupNumber: number | null = null;
    if (id) {
      const { error: e } = await supabase.from('community_custom_groups').update(payload).eq('id', id);
      if (e) alert(e.message);
    } else {
      groupNumber = Math.max(5, ...customGroups.map((c) => c.member_group)) + 1;
      const { data, error: e } = await supabase
        .from('community_custom_groups')
        .insert({ ...payload, reseller_id: resellerId, member_group: groupNumber })
        .select('id')
        .single();
      if (e) alert(e.message);
      id = data?.id ?? null;
    }
    setGroupSaving(false);
    if (!id) return;
    setGroupForm(null);
    await refreshGroups();
    onGroupsChanged?.();
    if (groupNumber) setOpenGroup(groupNumber);
  };
  const deleteGroup = async (customId: string, label: string, count: number) => {
    if (!confirm(`Supprimer le groupe « ${label} » ?${count ? ` Ses ${count} membre(s) deviendront non classés.` : ''} Ses prix programmés sont supprimés.`)) return;
    const { error: e } = await supabase.rpc('admin_delete_custom_group', { p_group_id: customId });
    if (e) return alert(e.message);
    for (const m of contacts) if (m.member_group === openGroup) onMemberGroupChanged?.(m.id, null);
    setOpenGroup(null);
    await refreshGroups();
    refresh();
    onGroupsChanged?.();
  };

  // Ajout / retrait de membres dans le groupe ouvert.
  const [memberSearch, setMemberSearch] = useState('');
  const [movingId, setMovingId] = useState<string | null>(null);
  const setGroupOf = async (contactId: string, group: number | null) => {
    setMovingId(contactId);
    const { error: e } = await supabase.rpc('set_member_group', { p_contact_id: contactId, p_group: group });
    setMovingId(null);
    if (e) return alert(e.message);
    onMemberGroupChanged?.(contactId, group);
  };
  const addCandidates = useMemo(() => {
    if (!openGroup) return [];
    const q = memberSearch.trim().toLowerCase();
    if (!q) return [];
    return contacts
      .filter((m) => !m.is_primary && m.member_group !== openGroup)
      .filter((m) => `${m.first_name} ${m.last_name} ${m.email}`.toLowerCase().includes(q))
      .slice(0, 20);
  }, [contacts, openGroup, memberSearch]);

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
        message: (messages[l.g] || '').trim() || null,
        created_by: user?.id ?? null,
      })),
      { onConflict: 'reseller_id,member_group,effective_from' }
    );
    setSaving(false);
    if (upsertError) return setError(upsertError.message);
    setNotice(`Prix programmés à partir du ${formatPriceDate(effectiveFrom)}.`);
    refresh();
  };

  // Modification d'un changement programmé (date, prix, message).
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDate, setEditDate] = useState('');
  const [editPrice, setEditPrice] = useState('');
  const [editMessage, setEditMessage] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  // Déplacement de tous les changements d'une même date.
  const [moveFrom, setMoveFrom] = useState<string | null>(null);
  const [moveTo, setMoveTo] = useState('');

  const startEdit = (r: { id: string; effective_from: string; monthly_price: number; message: string | null }) => {
    setEditingId(r.id);
    setEditDate(r.effective_from);
    setEditPrice(String(r.monthly_price).replace('.', ','));
    setEditMessage(r.message || '');
    setError(null);
  };

  const saveEdit = async () => {
    if (!editingId) return;
    const price = Number(editPrice.replace(',', '.'));
    if (!editDate) return setError("Choisis la date d'application");
    if (!Number.isFinite(price) || price < 0) return setError('Prix invalide');
    setEditSaving(true);
    const { error: updateError } = await supabase
      .from('community_group_prices')
      .update({ effective_from: editDate, monthly_price: Math.round(price * 100) / 100, message: editMessage.trim() || null })
      .eq('id', editingId);
    setEditSaving(false);
    if (updateError) {
      return setError(updateError.code === '23505' ? 'Ce groupe a déjà un changement programmé à cette date.' : updateError.message);
    }
    setEditingId(null);
    setNotice('Changement de prix modifié : les membres concernés verront la nouvelle date et le nouveau prix à leur prochaine connexion.');
    refresh();
  };

  const moveDate = async () => {
    if (!moveFrom || !moveTo) return;
    if (!confirm(`Déplacer tous les changements du ${formatPriceDate(moveFrom)} au ${formatPriceDate(moveTo)} ?`)) return;
    setEditSaving(true);
    const { error: updateError } = await supabase
      .from('community_group_prices')
      .update({ effective_from: moveTo })
      .eq('reseller_id', resellerId)
      .eq('effective_from', moveFrom);
    setEditSaving(false);
    if (updateError) {
      return setError(updateError.code === '23505' ? 'Un des groupes a déjà un changement programmé à cette nouvelle date.' : updateError.message);
    }
    setMoveFrom(null);
    setMoveTo('');
    setNotice(`Changements déplacés au ${formatPriceDate(moveTo)}.`);
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
          const i = info[g.id] ?? emptyInfo;
          return (
            <Card key={g.id} onClick={() => setOpenGroup(openGroup === g.id ? null : g.id)} className={`cursor-pointer transition-shadow hover:shadow-md ${openGroup === g.id ? 'ring-2 ring-gray-900' : ''}`}>
              <CardContent className="p-4">
                <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-semibold ${g.className}`}>{g.label}</span>
                <p className="mt-2 text-xs text-gray-500">
                  {counts[g.id] || 0} membre{(counts[g.id] || 0) > 1 ? 's' : ''}
                  {paying[g.id] ? <span className="ml-1 font-medium text-green-700">· {paying[g.id]} abonné{paying[g.id] > 1 ? 's' : ''}</span> : null}
                </p>
                <p className="mt-2 text-lg font-semibold text-gray-900">
                  {i.current ? formatMonthlyPrice(i.current.monthly_price) : <span className="text-sm font-normal text-gray-400">Aucun prix en vigueur</span>}
                </p>
                {i.upcoming && (
                  <p className="mt-1 text-xs text-amber-700">
                    {formatMonthlyPrice(i.upcoming.monthly_price)} à partir du {formatPriceDate(i.upcoming.effective_from)}
                  </p>
                )}
                <p className="mt-2 text-xs font-medium text-gray-500 underline">{openGroup === g.id ? 'Masquer les membres' : 'Voir les membres'}</p>
              </CardContent>
            </Card>
          );
        })}
        <button
          type="button"
          onClick={() => setGroupForm({ id: null, label: '', hint: '', color: GROUP_COLORS[0].id })}
          className="flex min-h-[120px] flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-gray-200 text-sm font-medium text-gray-500 hover:border-gray-400 hover:text-gray-800"
        >
          <Plus className="h-5 w-5" /> Nouveau groupe
        </button>
      </div>

      {groupForm && (
        <Card>
          <CardContent className="space-y-3 p-4">
            <p className="text-sm font-semibold text-gray-900">{groupForm.id ? 'Modifier le groupe' : 'Nouveau groupe'}</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="text-xs text-gray-600">
                Nom
                <input
                  value={groupForm.label}
                  onChange={(e) => setGroupForm({ ...groupForm, label: e.target.value })}
                  placeholder="ex. Offre VIP 1 000 €"
                  className={`${input} mt-1 w-full`}
                  autoFocus
                />
              </label>
              <label className="text-xs text-gray-600">
                Description (facultatif)
                <input
                  value={groupForm.hint}
                  onChange={(e) => setGroupForm({ ...groupForm, hint: e.target.value })}
                  placeholder="ex. A payé 1 000 € pour accéder"
                  className={`${input} mt-1 w-full`}
                />
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              {GROUP_COLORS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setGroupForm({ ...groupForm, color: c.id })}
                  className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${c.className} ${groupForm.color === c.id ? 'ring-2 ring-gray-900' : ''}`}
                >
                  {groupForm.label.trim() || c.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-500">Une fois créé, ouvre le groupe pour y ajouter les membres de ton choix, et programme son prix plus bas.</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={saveGroup}
                disabled={groupSaving}
                className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
              >
                {groupSaving ? 'Enregistrement…' : groupForm.id ? 'Enregistrer' : 'Créer le groupe'}
              </button>
              <button type="button" onClick={() => setGroupForm(null)} className="rounded-lg px-3 py-2 text-sm text-gray-600 hover:bg-gray-100">
                Annuler
              </button>
            </div>
          </CardContent>
        </Card>
      )}
      <CommunityOfferFeesCard resellerId={resellerId} />

      {unclassified > 0 && (
        <p className="text-xs text-amber-700">
          {unclassified} membre{unclassified > 1 ? 's ne sont' : " n'est"} pas encore classé{unclassified > 1 ? 's' : ''} dans un groupe : aucun prix ne {unclassified > 1 ? 'leur' : 'lui'} sera annoncé.{' '}
          <button type="button" onClick={() => setOpenGroup(openGroup === 0 ? null : 0)} className="font-medium underline">
            {openGroup === 0 ? 'Masquer' : 'Voir'}
          </button>
        </p>
      )}

      {openGroup !== null && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-gray-900">
                {openGroup === 0 ? 'Membres non classés' : MEMBER_GROUPS.find((g) => g.id === openGroup)?.label} · {openMembers.length} membre{openMembers.length > 1 ? 's' : ''}
              </p>
              <span className="flex items-center gap-3">
                {(() => {
                  const g = MEMBER_GROUPS.find((x) => x.id === openGroup);
                  const c = customGroups.find((x) => x.id === g?.customId);
                  return c ? (
                    <>
                      <button
                        type="button"
                        onClick={() => setGroupForm({ id: c.id, label: c.label, hint: c.hint || '', color: c.color })}
                        className="text-xs font-medium text-gray-600 underline hover:text-gray-900"
                      >
                        Modifier le groupe
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteGroup(c.id, c.label, openMembers.length)}
                        className="text-xs font-medium text-red-600 underline hover:text-red-800"
                      >
                        Supprimer le groupe
                      </button>
                    </>
                  ) : null;
                })()}
                <button type="button" onClick={() => setOpenGroup(null)} className="text-xs text-gray-500 hover:text-gray-800">Fermer</button>
              </span>
            </div>
            {openGroup !== 0 && (
              <div className="mt-3">
                <div className="relative max-w-sm">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  <input
                    value={memberSearch}
                    onChange={(e) => setMemberSearch(e.target.value)}
                    placeholder="Ajouter un membre : nom ou email"
                    className={`${input} w-full pl-9`}
                  />
                </div>
                {memberSearch.trim() && (
                  <ul className="mt-2 max-w-xl divide-y divide-gray-100 rounded-lg border border-gray-100">
                    {addCandidates.length === 0 && <li className="px-3 py-2 text-xs text-gray-400">Aucun membre trouvé.</li>}
                    {addCandidates.map((m) => {
                      const current = MEMBER_GROUPS.find((x) => x.id === m.member_group);
                      return (
                        <li key={m.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                          <span className="min-w-0">
                            <span className="font-medium text-gray-900">{[m.first_name, m.last_name].filter(Boolean).join(' ') || m.email}</span>
                            <span className="ml-2 text-xs text-gray-500">{m.email}</span>
                            <span className="ml-2 text-xs text-gray-400">{current ? `(actuellement ${current.short})` : '(non classé)'}</span>
                          </span>
                          <button
                            type="button"
                            onClick={() => setGroupOf(m.id, openGroup)}
                            disabled={movingId === m.id}
                            className="flex-shrink-0 rounded-lg bg-gray-900 px-3 py-1 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50"
                          >
                            Ajouter
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
            {openMembers.length === 0 ? (
              <p className="mt-3 text-sm text-gray-400">Aucun membre dans ce groupe.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                      <th className="py-2 pr-4 font-medium">Membre</th>
                      <th className="py-2 pr-4 font-medium">Inscrit le</th>
                      <th className="py-2 pr-4 font-medium">Abonnement</th>
                      <th className="py-2 pr-4 font-medium">Prochaine échéance</th>
                      <th className="py-2 text-right font-medium">Total payé</th>
                      {openGroup !== 0 && <th className="py-2" />}
                    </tr>
                  </thead>
                  <tbody>
                    {openMembers.map((m) => {
                      const sub = subs[m.id];
                      const status = m.access_revoked_at
                        ? { label: `Accès retiré le ${new Date(m.access_revoked_at).toLocaleDateString('fr-FR')}`, className: 'bg-red-50 text-red-700' }
                        : memberSubStatus(sub);
                      return (
                        <tr key={m.id} className="border-b border-gray-50 last:border-b-0">
                          <td className="py-2 pr-4">
                            <p className="font-medium text-gray-900">{[m.first_name, m.last_name].filter(Boolean).join(' ') || '—'}</p>
                            <p className="text-xs text-gray-500">{m.email}</p>
                          </td>
                          <td className="py-2 pr-4 text-gray-600">{new Date(m.created_at).toLocaleDateString('fr-FR')}</td>
                          <td className="py-2 pr-4">
                            <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${status.className}`}>{status.label}</span>
                          </td>
                          <td className="py-2 pr-4 text-gray-600">
                            {sub?.community_sub_current_period_end && PAYING_STATUSES.includes(sub.community_sub_status || '')
                              ? new Date(sub.community_sub_current_period_end).toLocaleDateString('fr-FR')
                              : '—'}
                          </td>
                          <td className="py-2 text-right font-medium text-gray-900">
                            {sub?.total_paid ? sub.total_paid.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' }) : '—'}
                          </td>
                          {openGroup !== 0 && (
                            <td className="py-2 pl-3 text-right">
                              <button
                                type="button"
                                onClick={() => setGroupOf(m.id, null)}
                                disabled={movingId === m.id}
                                title="Retirer du groupe (le membre devient non classé)"
                                className="text-xs text-gray-400 hover:text-red-600 disabled:opacity-50"
                              >
                                Retirer
                              </button>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="space-y-4 p-4">
          <div>
            <p className="flex items-center gap-2 text-sm font-semibold text-gray-900">
              <CalendarClock className="h-4 w-4 text-gray-400" /> Programmer un changement de prix
            </p>
            <p className="text-xs text-gray-500">
              Le nouveau prix s'applique à partir de la date choisie. Les membres du groupe sont prévenus à chaque connexion jusqu'à cette date, avec ton message s'il y en a un. Écris {'{prénom}'} dans le message : il sera remplacé par le prénom de chaque membre. Les membres déjà abonnés passent automatiquement au nouveau prix à leur prochaine échéance après cette date.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {MEMBER_GROUPS.map((g) => (
              <div key={g.id} className={`space-y-2 rounded-lg border p-3 ${selected.has(g.id) ? 'border-gray-300' : 'border-gray-100 opacity-60'}`}>
              <label className="flex items-center gap-3">
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
              <textarea
                value={messages[g.id] ?? ''}
                onChange={(e) => setMessages((m) => ({ ...m, [g.id]: e.target.value }))}
                disabled={!selected.has(g.id)}
                rows={3}
                placeholder="Message aux membres de ce groupe (facultatif) — ex. : Bonjour {prénom}, …"
                className={`${input} w-full resize-y`}
              />
              </div>
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

            {/* Déplacer d'un coup tous les changements d'une même date */}
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg bg-gray-50 p-3 text-sm">
              {[...new Set(upcomingRows.map((r) => r.effective_from))].map((d) => {
                const count = upcomingRows.filter((r) => r.effective_from === d).length;
                return moveFrom === d ? (
                  <span key={d} className="flex flex-wrap items-center gap-2">
                    <span className="text-gray-700">Déplacer les {count} changement{count > 1 ? 's' : ''} du {formatPriceDate(d)} au</span>
                    <input type="date" value={moveTo} onChange={(e) => setMoveTo(e.target.value)} className={input} />
                    <button
                      type="button"
                      onClick={moveDate}
                      disabled={!moveTo || editSaving}
                      className="rounded-lg bg-gray-900 px-3 py-2 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50"
                    >
                      Déplacer
                    </button>
                    <button type="button" onClick={() => setMoveFrom(null)} className="text-xs text-gray-500 hover:text-gray-800">
                      Annuler
                    </button>
                  </span>
                ) : (
                  <button
                    key={d}
                    type="button"
                    onClick={() => {
                      setMoveFrom(d);
                      setMoveTo(d);
                    }}
                    className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100"
                  >
                    Changer la date du {formatPriceDate(d)} ({count} groupe{count > 1 ? 's' : ''})
                  </button>
                );
              })}
            </div>

            <ul className="divide-y divide-gray-100">
              {upcomingRows.map((r) =>
                editingId === r.id ? (
                  <li key={r.id} className="space-y-2 py-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-gray-800">{MEMBER_GROUPS.find((g) => g.id === r.member_group)?.label || `Groupe ${r.member_group}`}</span>
                      <span className="relative">
                        <input
                          value={editPrice}
                          onChange={(e) => setEditPrice(e.target.value)}
                          inputMode="decimal"
                          className={`${input} w-28 pr-7 text-right tabular-nums`}
                        />
                        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-400">€</span>
                      </span>
                      <span className="text-gray-600">/mois à partir du</span>
                      <input type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} className={input} />
                    </div>
                    <textarea
                      value={editMessage}
                      onChange={(e) => setEditMessage(e.target.value)}
                      rows={4}
                      placeholder="Message aux membres de ce groupe (facultatif)"
                      className={`${input} w-full resize-y`}
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={saveEdit}
                        disabled={editSaving}
                        className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50"
                      >
                        {editSaving ? 'Enregistrement…' : 'Enregistrer'}
                      </button>
                      <button type="button" onClick={() => setEditingId(null)} className="rounded-lg px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100">
                        Annuler
                      </button>
                    </div>
                  </li>
                ) : (
                  <li key={r.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span className="text-gray-800">
                      {MEMBER_GROUPS.find((g) => g.id === r.member_group)?.label || `Groupe ${r.member_group}`} → <strong>{formatMonthlyPrice(r.monthly_price)}</strong> à partir du {formatPriceDate(r.effective_from)}
                      {r.message && <span className="mt-0.5 block whitespace-pre-line text-xs text-gray-500">« {r.message} »</span>}
                    </span>
                    <span className="flex flex-shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => startEdit(r)}
                        className="rounded-lg px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100"
                      >
                        Modifier
                      </button>
                      <button onClick={() => removeRow(r.id)} className="p-1 text-gray-400 hover:text-red-600" title="Supprimer ce changement">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </span>
                  </li>
                )
              )}
            </ul>
            {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
            {notice && <p className="mt-2 text-sm text-green-700">{notice}</p>}
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default CommunityPricesTab;
