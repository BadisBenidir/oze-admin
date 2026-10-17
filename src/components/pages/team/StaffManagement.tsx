import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Plus, UserCog, X } from 'lucide-react';
import { Card, CardContent } from '../../ui/Card';
import { Badge } from '../../ui/Badge';
import { Toast } from '../../ui/Toast';
import { supabase, StaffAction, StaffPermissions } from '../../../lib/supabase';
import { navigationItems } from '../../../config/navigation';
import { invokeEdgeFunction } from '../../../utils/invokeEdgeFunction';

/**
 * Comptes employés (0208, fonction manage-staff) — propriétaire uniquement.
 * Pour chaque employé : pages de l'admin visibles, actions sensibles
 * autorisées, droit de voir les chiffres, accès ouvert ou suspendu.
 */

interface StaffMember {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  created_at: string;
  staff_permissions: StaffPermissions | StaffPermissions[] | null;
}

const ACTIONS: { id: StaffAction; label: string; hint: string }[] = [
  { id: 'refunds', label: 'Annuler et rembourser', hint: 'Commandes, articles, lots d\'enchères, demandes de livraison, certificats Entrupy' },
  { id: 'wallet', label: 'Ajuster les soldes', hint: 'Créditer ou retirer du solde B2B d\'un membre' },
  { id: 'invoicing', label: 'Facturation Qonto', hint: 'Émettre les factures, les marquer payées, synchroniser les paiements' },
  { id: 'accounts', label: 'Gérer les comptes membres', hint: 'Inviter, désactiver, changer email / mot de passe / profil' },
];

const PAGE_SECTIONS = navigationItems.filter((item) => item.id !== 'team');

const permsOf = (m: StaffMember): StaffPermissions | null =>
  Array.isArray(m.staff_permissions) ? m.staff_permissions[0] || null : m.staff_permissions;

const fullName = (m: Pick<StaffMember, 'first_name' | 'last_name' | 'email'>) =>
  `${m.first_name || ''} ${m.last_name || ''}`.trim() || m.email;

interface FormState {
  first_name: string;
  last_name: string;
  email: string;
  password: string;
  pages: string[];
  actions: StaffAction[];
  show_figures: boolean;
  show_revenue: boolean;
  active: boolean;
}

const StaffModal: React.FC<{ member: StaffMember | null; onClose: () => void; onSaved: (message: string) => void }> = ({ member, onClose, onSaved }) => {
  const perms = member ? permsOf(member) : null;
  const [form, setForm] = useState<FormState>({
    first_name: member?.first_name || '',
    last_name: member?.last_name || '',
    email: member?.email || '',
    password: '',
    pages: perms?.pages || [],
    actions: perms?.actions || [],
    show_figures: perms?.show_figures ?? false,
    show_revenue: perms?.show_revenue ?? false,
    active: perms?.active ?? true,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const togglePage = (key: string) =>
    setForm((f) => ({ ...f, pages: f.pages.includes(key) ? f.pages.filter((p) => p !== key) : [...f.pages, key] }));
  const toggleSection = (sectionId: string, keys: string[]) =>
    setForm((f) => {
      const allOn = keys.every((k) => f.pages.includes(k));
      return { ...f, pages: allOn ? f.pages.filter((p) => !p.startsWith(`${sectionId}:`)) : Array.from(new Set([...f.pages, ...keys])) };
    });
  const toggleAction = (id: StaffAction) =>
    setForm((f) => ({ ...f, actions: f.actions.includes(id) ? f.actions.filter((a) => a !== id) : [...f.actions, id] }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!form.first_name.trim()) return setError('Prénom requis');
    if (!member && !form.email.trim()) return setError('Email requis');
    if ((!member || form.password) && form.password.length < 8) return setError('Mot de passe : 8 caractères minimum');
    if (form.pages.length === 0) return setError('Coche au moins une page');

    setSaving(true);
    const base = {
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim(),
      pages: form.pages,
      actions: form.actions,
      show_figures: form.show_figures,
      show_revenue: form.show_revenue,
    };
    const { error: fnError } = await invokeEdgeFunction('manage-staff', member
      ? { action: 'update', profile_id: member.id, ...base, active: form.active }
      : { action: 'create', email: form.email.trim(), password: form.password, ...base });
    if (!fnError && member && form.password) {
      const { error: pwError } = await invokeEdgeFunction('manage-staff', { action: 'password', profile_id: member.id, password: form.password });
      if (pwError) {
        setSaving(false);
        return setError(`Droits enregistrés, mais le mot de passe n'a pas été changé : ${pwError}`);
      }
    }
    setSaving(false);
    if (fnError) return setError(fnError);
    onSaved(member ? `Compte de ${base.first_name} mis à jour.` : `Compte de ${base.first_name} créé : transmets-lui son email et son mot de passe.`);
    onClose();
  };

  const input = 'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none';

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black bg-opacity-50" onClick={onClose} />
      <div className="flex min-h-full items-center justify-center p-4">
        <form onSubmit={submit} className="relative w-full max-w-2xl rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between border-b border-gray-100 p-5">
            <h3 className="text-base font-semibold text-gray-900">{member ? `Modifier ${fullName(member)}` : 'Nouvel employé'}</h3>
            <button type="button" onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:text-gray-600">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="space-y-5 p-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Prénom</label>
                <input value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} className={input} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Nom</label>
                <input value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} className={input} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Email de connexion</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  disabled={Boolean(member)}
                  className={`${input} disabled:bg-gray-50 disabled:text-gray-500`}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">
                  {member ? 'Nouveau mot de passe (facultatif)' : 'Mot de passe'}
                </label>
                <input
                  type="text"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder={member ? 'Laisser vide pour ne pas changer' : '8 caractères minimum'}
                  autoComplete="new-password"
                  className={input}
                />
              </div>
            </div>

            <div>
              <p className="mb-2 text-sm font-semibold text-gray-900">Pages visibles</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {PAGE_SECTIONS.map((section) => {
                  const keys = (section.subItems || []).map((sub) => `${section.id}:${sub.id}`);
                  const allOn = keys.length > 0 && keys.every((k) => form.pages.includes(k));
                  return (
                    <div key={section.id} className="rounded-lg border border-gray-100 p-3">
                      <label className="flex items-center gap-2 text-sm font-medium text-gray-900">
                        <input type="checkbox" checked={allOn} onChange={() => toggleSection(section.id, keys)} className="h-4 w-4 accent-gray-900" />
                        {section.label}
                      </label>
                      {(section.subItems?.length ?? 0) > 1 && (
                        <div className="mt-2 ml-6 space-y-1">
                          {section.subItems!.map((sub) => {
                            const key = `${section.id}:${sub.id}`;
                            return (
                              <label key={key} className="flex items-center gap-2 text-xs text-gray-700">
                                <input type="checkbox" checked={form.pages.includes(key)} onChange={() => togglePage(key)} className="h-3.5 w-3.5 accent-gray-900" />
                                {sub.label}
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div>
              <p className="mb-2 text-sm font-semibold text-gray-900">Actions sensibles autorisées</p>
              <div className="space-y-2">
                {ACTIONS.map((a) => (
                  <label key={a.id} className="flex items-start gap-2 text-sm text-gray-700">
                    <input type="checkbox" checked={form.actions.includes(a.id)} onChange={() => toggleAction(a.id)} className="mt-0.5 h-4 w-4 accent-gray-900" />
                    <span>
                      {a.label}
                      <span className="block text-xs text-gray-500">{a.hint}</span>
                    </span>
                  </label>
                ))}
                <label className="flex items-start gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={form.show_figures}
                    onChange={() => setForm({ ...form, show_figures: !form.show_figures })}
                    className="mt-0.5 h-4 w-4 accent-gray-900"
                  />
                  <span>
                    Voir les prix d'achat et les marges
                    <span className="block text-xs text-gray-500">Prix d'achat, coûts du sourcing, marges — sinon masqués (••••)</span>
                  </span>
                </label>
                <label className="flex items-start gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={form.show_revenue}
                    onChange={() => setForm({ ...form, show_revenue: !form.show_revenue })}
                    className="mt-0.5 h-4 w-4 accent-gray-900"
                  />
                  <span>
                    Voir le chiffre d'affaires
                    <span className="block text-xs text-gray-500">CA total du Dashboard et de la page CA B2B — les montants de chaque vente restent visibles</span>
                  </span>
                </label>
              </div>
            </div>

            {member && (
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={form.active} onChange={() => setForm({ ...form, active: !form.active })} className="h-4 w-4 accent-gray-900" />
                Accès actif <span className="text-xs text-gray-500">(décoché : il est déconnecté et ne peut plus se connecter)</span>
              </label>
            )}

            {error && (
              <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3">
                <AlertCircle className="h-4 w-4 flex-shrink-0 text-red-600" />
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-3 p-5 pt-0">
            <button type="button" onClick={onClose} className="rounded-lg bg-gray-100 px-4 py-2 text-sm text-gray-700 hover:bg-gray-200">
              Annuler
            </button>
            <button type="submit" disabled={saving} className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50">
              {saving ? 'Enregistrement…' : member ? 'Enregistrer' : 'Créer le compte'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export const StaffManagement: React.FC = () => {
  const [members, setMembers] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<StaffMember | 'new' | null>(null);
  const [toast, setToast] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: fetchError } = await supabase
      .from('profiles')
      .select('id, email, first_name, last_name, created_at, staff_permissions!staff_permissions_profile_id_fkey(*)')
      .eq('role', 'staff')
      .order('created_at', { ascending: true });
    if (fetchError) setError(fetchError.message);
    else setMembers((data || []) as unknown as StaffMember[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const remove = async (m: StaffMember) => {
    if (!confirm(`Supprimer définitivement le compte de ${fullName(m)} ?`)) return;
    const { error: fnError } = await invokeEdgeFunction('manage-staff', { action: 'delete', profile_id: m.id });
    if (fnError) setError(fnError);
    else setToast(`Compte de ${fullName(m)} supprimé.`);
    load();
  };

  const pageLabel = (key: string) => {
    const [tab, sub] = key.split(':');
    const section = navigationItems.find((i) => i.id === tab);
    const item = section?.subItems?.find((s) => s.id === sub);
    return section && item ? ((section.subItems?.length ?? 0) > 1 ? `${section.label} › ${item.label}` : section.label) : key;
  };

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Employés</h3>
          <p className="text-sm text-gray-500">Accès à l'admin avec les pages et les actions que tu choisis.</p>
        </div>
        <button
          onClick={() => setEditing('new')}
          className="flex items-center gap-1.5 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
        >
          <Plus className="h-4 w-4" /> Ajouter un employé
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3">
          <AlertCircle className="h-4 w-4 flex-shrink-0 text-red-600" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <p className="p-6 text-center text-sm text-gray-400">Chargement…</p>
          ) : members.length === 0 ? (
            <div className="p-10 text-center">
              <UserCog className="mx-auto mb-3 h-8 w-8 text-gray-300" />
              <p className="text-sm text-gray-500">Aucun employé pour l'instant.</p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {members.map((m) => {
                const perms = permsOf(m);
                return (
                  <li key={m.id} className="flex flex-col gap-2 p-4 md:flex-row md:items-center md:justify-between">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 text-sm font-medium text-gray-900">
                        {fullName(m)}
                        {perms?.active ? <Badge variant="success">Actif</Badge> : <Badge variant="default">Suspendu</Badge>}
                      </p>
                      <p className="text-xs text-gray-500">{m.email}</p>
                      <p className="mt-1 text-xs text-gray-600">
                        {(perms?.pages || []).map(pageLabel).join(' · ') || 'Aucune page'}
                      </p>
                      <p className="text-xs text-gray-400">
                        {[
                          ...ACTIONS.filter((a) => perms?.actions.includes(a.id)).map((a) => a.label),
                          perms?.show_figures ? 'Voit les prix d\x27achat' : 'Prix d\x27achat masqués',
                          perms?.show_revenue ? 'Voit le CA' : 'CA masqué',
                        ].join(' · ')}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => setEditing(m)} className="rounded-lg px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100">
                        Modifier
                      </button>
                      <button onClick={() => remove(m)} className="rounded-lg px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50">
                        Supprimer
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {editing && (
        <StaffModal
          key={editing === 'new' ? 'new' : editing.id}
          member={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(message) => {
            setToast(message);
            load();
          }}
        />
      )}
      {toast && <Toast message={toast} onDismiss={() => setToast('')} />}
    </div>
  );
};

export default StaffManagement;
