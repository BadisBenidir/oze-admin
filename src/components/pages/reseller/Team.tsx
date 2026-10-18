import React, { useEffect, useMemo, useState } from 'react';
import { Card, CardContent } from '../../ui/Card';
import { Badge } from '../../ui/Badge';
import { Toast } from '../../ui/Toast';
import { ConfirmModal } from '../../ui/ConfirmModal';
import { supabase } from '../../../lib/supabase';
import { useResellerAuth } from '../../../hooks/useResellerAuth';
import { useResellerTeam, TeamMember } from '../../../hooks/useResellerTeam';
import { generateSecurePassword } from '../../../utils/generatePassword';
import { TeamMemberDetail } from './TeamMemberDetail';
import { InviteLinkPanel } from '../../reseller/InviteLinkPanel';
import { MEMBER_GROUPS, memberGroupOf } from '../../../config/memberGroups';
import { useCommunityGroupPrices, DEFAULT_GROUP_PRICES, formatMonthlyPrice, formatPriceDate } from '../../../hooks/useCommunityGroupPrices';
import {
  Users, UserPlus, Trash2, AlertCircle, Mail, Phone, Crown, Eye, KeyRound, Copy, Check, Search, X, UserCheck,
} from 'lucide-react';

const INVITE_COOLDOWN_SECONDS = 30;

interface TeamProps {
  onOpenProduct: (productId: string) => void;
}

/** Activité d'un membre : a-t-il acheté, quand pour la dernière fois, et ce
 * mois-ci — jamais le nombre de commandes ni les montants (non chargés). */
interface MemberActivity {
  orders: number;
  lastPurchase: string | null;
  boughtThisMonth: boolean;
}

type StatusFilter = 'all' | 'active' | 'pending' | 'buyers' | 'never';
type SortKey = 'recent' | 'name' | 'last_purchase';

const initials = (m: TeamMember) => `${m.first_name?.[0] || ''}${m.last_name?.[0] || ''}`.toUpperCase() || '?';
const normalize = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * « Mon équipe » (contact principal d'une entreprise partenaire) : membres de
 * la communauté (date d'inscription, dernier achat — jamais le nombre de
 * commandes ni les montants dépensés), recherche,
 * filtres et tri ; ajout d'un membre (lien d'invitation, email ou mot de passe)
 * dans une fenêtre dédiée ; détail, nouveau mot de passe et suppression.
 */
export const Team: React.FC<TeamProps> = ({ onOpenProduct }) => {
  const { profile } = useResellerAuth();
  const { members, loading, error, inviteTeammate, removeTeammate, resetTeammatePassword, setMemberGroup } = useResellerTeam(profile?.reseller_id);
  const { info: groupPrices } = useCommunityGroupPrices(profile?.is_primary ? profile?.reseller_id : null);
  const [groupFilter, setGroupFilter] = useState<'all' | 'none' | number>('all');
  const [groupError, setGroupError] = useState<string | null>(null);
  const handleGroupChange = async (m: TeamMember, value: string) => {
    setGroupError(null);
    const result = await setMemberGroup(m.id, value ? Number(value) : null);
    if (!result.success) setGroupError(result.error || 'Impossible de changer le groupe');
  };

  const [mode, setMode] = useState<'email' | 'password'>('email');
  const [form, setForm] = useState({ email: '', first_name: '', last_name: '', password: '', phone: '' });
  const [inviting, setInviting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [createdCredentials, setCreatedCredentials] = useState<{ email: string; password: string } | null>(null);
  const [convertedNotice, setConvertedNotice] = useState<string | null>(null);
  const [successToast, setSuccessToast] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [viewingMember, setViewingMember] = useState<TeamMember | null>(null);
  const [memberToRemove, setMemberToRemove] = useState<TeamMember | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [memberToReset, setMemberToReset] = useState<TeamMember | null>(null);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetResult, setResetResult] = useState<{ member: TeamMember; password: string; sessionsRevoked: boolean } | null>(null);
  const [passwordCopied, setPasswordCopied] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('recent');
  const [activity, setActivity] = useState<Record<string, MemberActivity>>({});

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  // Activité d'achat de chaque membre (le contact principal lit les
  // commandes de son entreprise, voir orders_reseller_select_own).
  useEffect(() => {
    if (!profile?.reseller_id || !profile.is_primary) return;
    let cancelled = false;
    supabase
      .from('orders')
      .select('placed_by_profile_id, created_at, status, payment_status')
      .eq('reseller_id', profile.reseller_id)
      .eq('order_channel', 'b2b')
      .not('placed_by_profile_id', 'is', null)
      .then(({ data }) => {
        if (cancelled) return;
        const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
        const next: Record<string, MemberActivity> = {};
        for (const o of (data || []) as { placed_by_profile_id: string; created_at: string; status: string; payment_status: string }[]) {
          const paid = ['paid', 'succeeded'].includes(o.payment_status) || ['shipped', 'delivered'].includes(o.status);
          if (!paid || ['cancelled', 'canceled'].includes(o.status)) continue;
          const a = next[o.placed_by_profile_id] || { orders: 0, lastPurchase: null, boughtThisMonth: false };
          a.orders += 1;
          if (o.created_at >= monthStart) a.boughtThisMonth = true;
          if (!a.lastPurchase || o.created_at > a.lastPurchase) a.lastPurchase = o.created_at;
          next[o.placed_by_profile_id] = a;
        }
        setActivity(next);
      });
    return () => {
      cancelled = true;
    };
  }, [profile?.reseller_id, profile?.is_primary]);

  const stats = useMemo(() => {
    const activeCount = members.filter((m) => m.activated_at).length;
    return { total: members.length, active: activeCount, pending: members.length - activeCount };
  }, [members, activity]);

  const visibleMembers = useMemo(() => {
    const term = normalize(search.trim());
    const list = members.filter((m) => {
      const a = activity[m.profile_id];
      if (statusFilter === 'active' && !m.activated_at) return false;
      if (statusFilter === 'pending' && m.activated_at) return false;
      if (statusFilter === 'buyers' && !a?.orders) return false;
      if (statusFilter === 'never' && a?.orders) return false;
      if (groupFilter === 'none' && (m.is_primary || m.member_group)) return false;
      if (typeof groupFilter === 'number' && m.member_group !== groupFilter) return false;
      if (!term) return true;
      return normalize(`${m.first_name} ${m.last_name} ${m.email} ${m.phone || ''}`).includes(term);
    });
    const byName = (x: TeamMember, y: TeamMember) => `${x.first_name} ${x.last_name}`.localeCompare(`${y.first_name} ${y.last_name}`);
    return list.sort((x, y) => {
      // Le contact principal reste toujours en tête.
      if (x.is_primary !== y.is_primary) return x.is_primary ? -1 : 1;
      const ax = activity[x.profile_id];
      const ay = activity[y.profile_id];
      if (sortKey === 'name') return byName(x, y);
      if (sortKey === 'last_purchase') return (ay?.lastPurchase || '').localeCompare(ax?.lastPurchase || '') || byName(x, y);
      return y.created_at.localeCompare(x.created_at);
    });
  }, [members, activity, search, statusFilter, sortKey, groupFilter]);

  const groupCounts = useMemo(() => {
    const counts: Record<string, number> = { none: 0 };
    for (const m of members) {
      if (m.is_primary) continue;
      const key = m.member_group ? String(m.member_group) : 'none';
      counts[key] = (counts[key] || 0) + 1;
    }
    return counts;
  }, [members]);

  if (!profile?.is_primary) {
    return (
      <div className="p-4 md:p-6">
        <div className="text-center py-12">
          <Users className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">Accès réservé</h3>
          <p className="text-gray-500">Seul le contact principal de l'entreprise peut gérer l'équipe.</p>
        </div>
      </div>
    );
  }

  const generatePassword = () => setForm((f) => ({ ...f, password: generateSecurePassword() }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setCreatedCredentials(null);
    setConvertedNotice(null);

    if (!form.email.trim()) {
      setFormError("L'email est obligatoire");
      return;
    }
    if (mode === 'password' && form.password.trim().length < 8) {
      setFormError('Le mot de passe doit contenir au moins 8 caractères');
      return;
    }

    setInviting(true);
    try {
      const result = await inviteTeammate(
        form.email.trim(),
        form.first_name.trim(),
        form.last_name.trim(),
        mode === 'password' ? form.password.trim() : undefined,
        form.phone.trim() || undefined
      );
      if (result.success) {
        if (mode === 'password') {
          setCreatedCredentials({ email: form.email.trim(), password: form.password.trim() });
        } else if (result.convertedExistingAccount) {
          setConvertedNotice(`${form.email.trim()} avait déjà un compte OZË Paris : accès pro activé immédiatement, aucun email envoyé — cette personne se connecte avec son mot de passe habituel.`);
        } else {
          setSuccessToast("L'invitation a bien été envoyée avec succès !");
          setCooldown(INVITE_COOLDOWN_SECONDS);
          setShowAddModal(false);
        }
        setForm({ email: '', first_name: '', last_name: '', password: '', phone: '' });
      } else {
        setFormError(result.error || 'Erreur lors de la création du compte');
      }
    } finally {
      setInviting(false);
    }
  };

  const handleConfirmRemove = async () => {
    if (!memberToRemove) return;
    setRemoving(true);
    setRemoveError(null);
    const result = await removeTeammate(memberToRemove.id);
    setRemoving(false);
    if (result.success) {
      setMemberToRemove(null);
    } else {
      setRemoveError(result.error || 'Erreur lors de la suppression');
    }
  };

  const handleConfirmReset = async () => {
    if (!memberToReset) return;
    setResetting(true);
    setResetError(null);
    const result = await resetTeammatePassword(memberToReset.profile_id);
    setResetting(false);
    if (result.success && result.password) {
      setResetResult({ member: memberToReset, password: result.password, sessionsRevoked: result.sessionsRevoked !== false });
      setMemberToReset(null);
    } else {
      setResetError(result.error || 'Erreur lors de la réinitialisation');
    }
  };

  const handleCopyPassword = () => {
    if (!resetResult) return;
    navigator.clipboard.writeText(resetResult.password);
    setPasswordCopied(true);
    setTimeout(() => setPasswordCopied(false), 2000);
  };

  if (viewingMember) {
    return <TeamMemberDetail member={viewingMember} onBack={() => setViewingMember(null)} onOpenProduct={onOpenProduct} />;
  }

  const closeAddModal = () => {
    setShowAddModal(false);
    setFormError(null);
    setCreatedCredentials(null);
    setConvertedNotice(null);
  };

  const FILTERS: { id: StatusFilter; label: string; count: number }[] = [
    { id: 'all', label: 'Tous', count: stats.total },
    { id: 'active', label: 'Actifs', count: stats.active },
    { id: 'pending', label: 'Invitation en attente', count: stats.pending },
    { id: 'buyers', label: 'Ont déjà acheté', count: members.filter((m) => activity[m.profile_id]?.orders).length },
    { id: 'never', label: 'Jamais acheté', count: members.filter((m) => !activity[m.profile_id]?.orders).length },
  ];

  const Kpi: React.FC<{ icon: React.ElementType; label: string; value: string; hint?: string }> = ({ icon: Icon, label, value, hint }) => (
    <Card>
      <CardContent className="p-4">
        <p className="flex items-center gap-2 text-xs font-medium text-gray-500">
          <Icon className="h-4 w-4 text-gray-400" /> {label}
        </p>
        <p className="mt-1.5 text-2xl font-semibold tabular-nums text-gray-900">{value}</p>
        {hint && <p className="text-xs text-gray-500">{hint}</p>}
      </CardContent>
    </Card>
  );

  const groupSelect = (m: TeamMember) => {
    if (m.is_primary) return <span className="text-xs text-gray-400">—</span>;
    const g = memberGroupOf(m.member_group);
    const select = (
      <select
        value={m.member_group ?? ''}
        onChange={(e) => handleGroupChange(m, e.target.value)}
        title={g?.hint || 'Choisir le groupe d\x27accès de ce membre'}
        className={`rounded-full border px-2.5 py-1 text-xs font-medium focus:outline-none ${g ? g.className : 'border-dashed border-gray-300 bg-white text-gray-500'}`}
      >
        <option value="">Non classé</option>
        {MEMBER_GROUPS.map((opt) => (
          <option key={opt.id} value={opt.id}>{opt.label}</option>
        ))}
      </select>
    );
    return select;
  };

  /** Prix d'abonnement d'un groupe : prochain prix programmé, sinon prix en vigueur, sinon prix prévu par défaut. */
  const groupPrice = (group: number) => {
    const info = groupPrices[group];
    if (info?.upcoming) return { amount: info.upcoming.monthly_price, from: info.upcoming.effective_from };
    if (info?.current) return { amount: info.current.monthly_price, from: null };
    return { amount: DEFAULT_GROUP_PRICES[group] ?? 0, from: null };
  };

  const priceLabel = (m: TeamMember) => {
    if (m.is_primary || !m.member_group) return <span className="text-xs text-gray-400">—</span>;
    const p = groupPrice(m.member_group);
    return (
      <span className="text-sm font-medium tabular-nums text-gray-900">
        {formatMonthlyPrice(p.amount)}
        {p.from && <span className="block text-[11px] font-normal text-gray-500">dès le {formatPriceDate(p.from)}</span>}
      </span>
    );
  };

  const memberActions = (m: TeamMember) => (
    <div className="flex items-center justify-end gap-1">
      <button
        onClick={() => setViewingMember(m)}
        className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-900"
        title="Voir le détail"
      >
        <Eye className="h-4 w-4" />
      </button>
      {m.activated_at && !m.is_primary && (
        <button
          onClick={() => { setResetError(null); setMemberToReset(m); }}
          className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-900"
          title="Générer un nouveau mot de passe"
        >
          <KeyRound className="h-4 w-4" />
        </button>
      )}
      {!m.is_primary && (
        <button
          onClick={() => { setRemoveError(null); setMemberToRemove(m); }}
          className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600"
          title="Retirer ce membre"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      )}
    </div>
  );

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Mon équipe</h3>
          <p className="text-sm text-gray-500">Les membres de {profile.company_name} et leur activité.</p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center justify-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-800"
        >
          <UserPlus className="h-4 w-4" /> Ajouter un membre
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3">
          <AlertCircle className="h-4 w-4 flex-shrink-0 text-red-600" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Kpi icon={Users} label="Membres" value={String(stats.total)} />
        <Kpi icon={UserCheck} label="Comptes actifs" value={String(stats.active)} hint={stats.pending ? `${stats.pending} invitation${stats.pending > 1 ? 's' : ''} en attente` : undefined} />
      </div>

      {resetResult && (
        <div className="space-y-2 rounded-lg border border-green-200 bg-green-50 p-3">
          <p className="text-sm font-medium text-green-800">
            Nouveau mot de passe généré pour {resetResult.member.first_name} {resetResult.member.last_name} — transmets-le lui :
          </p>
          <div className="flex items-center justify-between gap-2 rounded-lg border border-green-200 bg-white p-2">
            <span className="break-all font-mono text-sm text-gray-900">{resetResult.password}</span>
            <button onClick={handleCopyPassword} className="flex-shrink-0 p-1.5 text-gray-400 transition-colors hover:text-gray-900" title="Copier">
              {passwordCopied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
            </button>
          </div>
          {resetResult.sessionsRevoked ? (
            <p className="text-xs text-green-700">Sa session précédente a été invalidée : il devra se reconnecter avec ce nouveau mot de passe.</p>
          ) : (
            <p className="flex items-center gap-1 text-xs text-amber-700">
              <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
              Le mot de passe a bien été changé, mais l'invalidation de sa session précédente a échoué — vérifie manuellement si besoin.
            </p>
          )}
          <button onClick={() => setResetResult(null)} className="text-xs text-green-700 underline hover:text-green-900">
            Fermer
          </button>
        </div>
      )}

      <Card>
        <CardContent className="p-4">
          <p className="text-sm font-medium text-gray-900">Groupes d'accès</p>
          <p className="mb-3 text-xs text-gray-500">Classe chaque membre selon ce qu'il a payé pour accéder à l'écosystème luxe — ce groupe définira le prix de son abonnement.</p>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
            {MEMBER_GROUPS.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => setGroupFilter(groupFilter === g.id ? 'all' : g.id)}
                className={`rounded-lg border px-3 py-2 text-left transition-shadow ${g.className} ${groupFilter === g.id ? 'ring-2 ring-gray-900' : ''}`}
              >
                <span className="block text-xs font-semibold">{g.label}</span>
                <span className="block text-lg font-semibold tabular-nums">{groupCounts[String(g.id)] || 0}</span>
                <span className="block text-xs font-medium tabular-nums opacity-80">{formatMonthlyPrice(groupPrice(g.id).amount)}</span>
              </button>
            ))}
            <button
              type="button"
              onClick={() => setGroupFilter(groupFilter === 'none' ? 'all' : 'none')}
              className={`rounded-lg border border-dashed border-gray-300 bg-white px-3 py-2 text-left text-gray-600 ${groupFilter === 'none' ? 'ring-2 ring-gray-900' : ''}`}
            >
              <span className="block text-xs font-semibold">Non classés</span>
              <span className="block text-lg font-semibold tabular-nums">{groupCounts.none || 0}</span>
            </button>
          </div>
          {groupError && <p className="mt-2 text-sm text-red-600">{groupError}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="flex flex-col gap-3 border-b border-gray-100 p-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative w-full lg:max-w-xs">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher un membre (nom, email, téléphone)"
                className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm focus:border-gray-400 focus:outline-none"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setStatusFilter(f.id)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    statusFilter === f.id ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {f.label} <span className={statusFilter === f.id ? 'text-gray-300' : 'text-gray-400'}>{f.count}</span>
                </button>
              ))}
              <select
                value={String(groupFilter)}
                onChange={(e) => setGroupFilter(e.target.value === 'all' || e.target.value === 'none' ? e.target.value : Number(e.target.value))}
                className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-700 focus:border-gray-400 focus:outline-none"
              >
                <option value="all">Tous les groupes</option>
                {MEMBER_GROUPS.map((g) => (
                  <option key={g.id} value={g.id}>{g.label} ({groupCounts[String(g.id)] || 0})</option>
                ))}
                <option value="none">Non classés ({groupCounts.none || 0})</option>
              </select>
              <select
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as SortKey)}
                className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-700 focus:border-gray-400 focus:outline-none"
              >
                <option value="recent">Inscription récente</option>
                <option value="name">Nom (A → Z)</option>
                <option value="last_purchase">Dernier achat</option>
              </select>
            </div>
          </div>

          {loading ? (
            <div className="space-y-2 p-4">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-12 animate-pulse rounded-lg bg-gray-100" />
              ))}
            </div>
          ) : visibleMembers.length === 0 ? (
            <p className="p-8 text-center text-sm text-gray-500">Aucun membre ne correspond à ta recherche.</p>
          ) : (
            <>
              {/* Ordinateur : tableau */}
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50 text-xs text-gray-500">
                      <th className="px-4 py-2.5 text-left font-medium">Membre</th>
                      <th className="px-4 py-2.5 text-left font-medium">Téléphone</th>
                      <th className="px-4 py-2.5 text-left font-medium">Inscrit le</th>
                      <th className="px-4 py-2.5 text-left font-medium">Groupe</th>
                      <th className="px-4 py-2.5 text-left font-medium">Statut</th>
                      <th className="px-4 py-2.5 text-left font-medium">Abonnement</th>
                      <th className="px-4 py-2.5 text-right font-medium">Dernier achat</th>
                      <th className="px-4 py-2.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {visibleMembers.map((m) => {
                      const a = activity[m.profile_id];
                      return (
                        <tr key={m.id} className="border-b border-gray-50 last:border-b-0 hover:bg-gray-50/60">
                          <td className="px-4 py-3">
                            <button onClick={() => setViewingMember(m)} className="flex items-center gap-3 text-left">
                              <span className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-xs font-medium text-white ${m.is_primary ? 'bg-amber-500' : 'bg-gray-900'}`}>
                                {m.is_primary ? <Crown className="h-4 w-4" /> : initials(m)}
                              </span>
                              <span className="min-w-0">
                                <span className="flex items-center gap-2 text-sm font-medium text-gray-900">
                                  {m.first_name} {m.last_name}
                                  {m.is_primary && <Badge variant="info">Principal</Badge>}
                                </span>
                                <span className="block truncate text-xs text-gray-500">{m.email}</span>
                              </span>
                            </button>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600">{m.phone || '—'}</td>
                          <td className="px-4 py-3 text-sm text-gray-600">{new Date(m.created_at).toLocaleDateString('fr-FR')}</td>
                          <td className="px-4 py-3">{groupSelect(m)}</td>
                          <td className="px-4 py-3">
                            {m.activated_at ? <Badge variant="success">Actif</Badge> : <Badge variant="warning">Invitation en attente</Badge>}
                          </td>
                          <td className="px-4 py-3">{priceLabel(m)}</td>
                          <td className="px-4 py-3 text-right text-sm text-gray-600">
                            {a?.lastPurchase ? new Date(a.lastPurchase).toLocaleDateString('fr-FR') : '—'}
                          </td>
                          <td className="px-4 py-3">{memberActions(m)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile : cartes */}
              <ul className="divide-y divide-gray-100 md:hidden">
                {visibleMembers.map((m) => {
                  const a = activity[m.profile_id];
                  return (
                    <li key={m.id} className="flex items-start justify-between gap-3 p-4">
                      <button onClick={() => setViewingMember(m)} className="flex min-w-0 items-start gap-3 text-left">
                        <span className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-xs font-medium text-white ${m.is_primary ? 'bg-amber-500' : 'bg-gray-900'}`}>
                          {m.is_primary ? <Crown className="h-4 w-4" /> : initials(m)}
                        </span>
                        <span className="min-w-0">
                          <span className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-gray-900">
                            {m.first_name} {m.last_name}
                            {m.activated_at ? <Badge variant="success">Actif</Badge> : <Badge variant="warning">En attente</Badge>}
                          </span>
                          <span className="block truncate text-xs text-gray-500">{m.email}</span>
                          <span className="block text-xs text-gray-500">
                            Inscrit le {new Date(m.created_at).toLocaleDateString('fr-FR')}{a?.lastPurchase ? ` · dernier achat le ${new Date(a.lastPurchase).toLocaleDateString('fr-FR')}` : ''}
                          </span>
                          {!m.is_primary && (
                            <span className="mt-1.5 flex flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>
                              {groupSelect(m)}
                              {m.member_group ? priceLabel(m) : null}
                            </span>
                          )}
                        </span>
                      </button>
                      {memberActions(m)}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </CardContent>
      </Card>

      {showAddModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="fixed inset-0 bg-black/40" onClick={closeAddModal} />
          <div className="flex min-h-full items-center justify-center p-4">
            <div className="relative w-full max-w-lg rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between border-b border-gray-100 p-5">
                <h3 className="text-base font-semibold text-gray-900">Ajouter un membre</h3>
                <button onClick={closeAddModal} className="rounded-lg p-1 text-gray-400 hover:text-gray-600">
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="space-y-5 p-5">
                {profile.reseller_id && <InviteLinkPanel resellerId={profile.reseller_id} />}

                <form onSubmit={handleSubmit} className="space-y-3 border-t border-gray-100 pt-5">
                  <p className="text-sm font-medium text-gray-700">Ou ajoute-le toi-même</p>

                  {formError && (
                    <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3">
                      <AlertCircle className="h-4 w-4 flex-shrink-0 text-red-600" />
                      <p className="text-sm text-red-700">{formError}</p>
                    </div>
                  )}

                  {createdCredentials && (
                    <div className="space-y-2 rounded-lg border border-green-200 bg-green-50 p-3">
                      <p className="text-sm font-medium text-green-800">Compte créé — communique ces identifiants à ton membre :</p>
                      <div className="space-y-1 rounded-lg border border-green-200 bg-white p-2">
                        <p className="text-xs text-gray-500">Email</p>
                        <p className="font-mono text-sm text-gray-900">{createdCredentials.email}</p>
                        <p className="mt-1 text-xs text-gray-500">Mot de passe</p>
                        <p className="font-mono text-sm text-gray-900">{createdCredentials.password}</p>
                      </div>
                    </div>
                  )}

                  {convertedNotice && (
                    <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
                      <p className="text-sm text-blue-800">{convertedNotice}</p>
                    </div>
                  )}

                  <div className="flex rounded-lg border border-gray-200 p-1 text-sm">
                    <button
                      type="button"
                      onClick={() => setMode('email')}
                      className={`flex-1 rounded-md py-1.5 transition-colors ${mode === 'email' ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
                    >
                      Inviter par email
                    </button>
                    <button
                      type="button"
                      onClick={() => setMode('password')}
                      className={`flex-1 rounded-md py-1.5 transition-colors ${mode === 'password' ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
                    >
                      Créer avec mot de passe
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <input
                      type="text"
                      placeholder="Prénom"
                      value={form.first_name}
                      onChange={(e) => setForm({ ...form, first_name: e.target.value })}
                      className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-gray-900"
                    />
                    <input
                      type="text"
                      placeholder="Nom"
                      value={form.last_name}
                      onChange={(e) => setForm({ ...form, last_name: e.target.value })}
                      className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-gray-900"
                    />
                  </div>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                    <input
                      type="email"
                      placeholder="membre@email.com"
                      value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                      className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm focus:border-transparent focus:ring-2 focus:ring-gray-900"
                      required
                    />
                  </div>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                    <input
                      type="tel"
                      placeholder="Téléphone (optionnel)"
                      value={form.phone}
                      onChange={(e) => setForm({ ...form, phone: e.target.value })}
                      className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm focus:border-transparent focus:ring-2 focus:ring-gray-900"
                    />
                  </div>

                  {mode === 'password' && (
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="Mot de passe (min. 8 caractères)"
                        value={form.password}
                        onChange={(e) => setForm({ ...form, password: e.target.value })}
                        className="flex-1 rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm focus:border-transparent focus:ring-2 focus:ring-gray-900"
                      />
                      <button
                        type="button"
                        onClick={generatePassword}
                        className="whitespace-nowrap rounded-lg bg-gray-100 px-3 py-2 text-xs text-gray-700 transition-colors hover:bg-gray-200"
                      >
                        Générer
                      </button>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={inviting || cooldown > 0}
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm text-white transition-colors hover:bg-gray-800 disabled:opacity-50"
                  >
                    <UserPlus className="h-4 w-4" />
                    <span>
                      {inviting
                        ? 'Chargement...'
                        : cooldown > 0
                        ? `Patientez ${cooldown}s...`
                        : mode === 'password'
                        ? 'Créer le compte'
                        : "Envoyer l'invitation"}
                    </span>
                  </button>
                </form>
              </div>
            </div>
          </div>
        </div>
      )}

      {successToast && <Toast message={successToast} onDismiss={() => setSuccessToast(null)} />}

      <ConfirmModal
        isOpen={Boolean(memberToRemove)}
        title="Retirer ce membre"
        message="Êtes-vous sûr de vouloir retirer ce membre de votre équipe ? Cette action est irréversible."
        isConfirming={removing}
        error={removeError}
        onConfirm={handleConfirmRemove}
        onCancel={() => { setMemberToRemove(null); setRemoveError(null); }}
      />

      <ConfirmModal
        isOpen={Boolean(memberToReset)}
        title="Générer un nouveau mot de passe"
        message={
          memberToReset
            ? `Un nouveau mot de passe temporaire va être généré pour ${memberToReset.first_name} ${memberToReset.last_name}. Sa session actuelle sera immédiatement déconnectée et son ancien mot de passe cessera de fonctionner.`
            : ''
        }
        confirmLabel="Générer"
        isConfirming={resetting}
        error={resetError}
        onConfirm={handleConfirmReset}
        onCancel={() => { setMemberToReset(null); setResetError(null); }}
      />
    </div>
  );
};
