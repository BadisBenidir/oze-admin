import React, { useEffect, useState } from 'react';
import { Card, CardContent } from '../../ui/Card';
import { Badge } from '../../ui/Badge';
import { Toast } from '../../ui/Toast';
import { ConfirmModal } from '../../ui/ConfirmModal';
import { useResellerAuth } from '../../../hooks/useResellerAuth';
import { useResellerTeam, TeamMember } from '../../../hooks/useResellerTeam';
import { generateSecurePassword } from '../../../utils/generatePassword';
import { TeamMemberDetail } from './TeamMemberDetail';
import { Users, UserPlus, Trash2, AlertCircle, Mail, Phone, Crown, Eye } from 'lucide-react';

const INVITE_COOLDOWN_SECONDS = 30;

export const Team: React.FC = () => {
  const { profile } = useResellerAuth();
  const { members, loading, error, inviteTeammate, removeTeammate } = useResellerTeam(profile?.reseller_id);

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

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

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

  if (viewingMember) {
    return <TeamMemberDetail member={viewingMember} onBack={() => setViewingMember(null)} />;
  }

  return (
    <div className="p-4 md:p-6 max-w-2xl">
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-gray-900">Mon équipe</h3>
        <p className="text-sm text-gray-500">Gère les comptes de connexion de tes collègues pour {profile.company_name}</p>
      </div>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-3 flex items-center space-x-2">
          <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <Card className="mb-6">
        <CardContent className="p-0">
          {loading ? (
            <div className="p-4 space-y-2">
              {[...Array(2)].map((_, i) => (
                <div key={i} className="h-10 bg-gray-100 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {members.map((m) => (
                <li key={m.id} className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center space-x-3">
                    <div className="h-8 w-8 bg-gray-900 rounded-full flex items-center justify-center flex-shrink-0">
                      {m.is_primary ? <Crown className="h-4 w-4 text-white" /> : <span className="text-white text-xs font-medium">{m.first_name[0]}{m.last_name[0]}</span>}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900">{m.first_name} {m.last_name}</p>
                      <p className="text-xs text-gray-500">{m.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {m.is_primary && <Badge variant="info">Principal</Badge>}
                    <button
                      onClick={() => setViewingMember(m)}
                      className="p-1 text-gray-400 hover:text-gray-900 transition-colors"
                      title="Voir les détails"
                    >
                      <Eye className="h-4 w-4" />
                    </button>
                    {!m.is_primary && (
                      <button
                        onClick={() => { setRemoveError(null); setMemberToRemove(m); }}
                        className="p-1 text-gray-400 hover:text-red-600 transition-colors"
                        title="Supprimer ce collaborateur"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {createdCredentials && (
        <div className="mb-4 bg-green-50 border border-green-200 rounded-lg p-3 space-y-2">
          <p className="text-sm font-medium text-green-800">Compte créé — communique ces identifiants à ton collègue :</p>
          <div className="bg-white rounded-lg border border-green-200 p-2 space-y-1">
            <p className="text-xs text-gray-500">Email</p>
            <p className="text-sm font-mono text-gray-900">{createdCredentials.email}</p>
            <p className="text-xs text-gray-500 mt-1">Mot de passe</p>
            <p className="text-sm font-mono text-gray-900">{createdCredentials.password}</p>
          </div>
        </div>
      )}

      {convertedNotice && (
        <div className="mb-4 bg-blue-50 border border-blue-200 rounded-lg p-3">
          <p className="text-sm text-blue-800">{convertedNotice}</p>
        </div>
      )}

      <Card>
        <CardContent className="p-4">
          <form onSubmit={handleSubmit} className="space-y-3">
            <p className="text-sm font-medium text-gray-700">Ajouter un collègue</p>

            {formError && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-center space-x-2">
                <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0" />
                <p className="text-sm text-red-700">{formError}</p>
              </div>
            )}

            <div className="flex rounded-lg border border-gray-200 p-1 text-sm">
              <button
                type="button"
                onClick={() => setMode('email')}
                className={`flex-1 py-1.5 rounded-md transition-colors ${mode === 'email' ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
              >
                Inviter par email
              </button>
              <button
                type="button"
                onClick={() => setMode('password')}
                className={`flex-1 py-1.5 rounded-md transition-colors ${mode === 'password' ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
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
                className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent text-sm"
              />
              <input
                type="text"
                placeholder="Nom"
                value={form.last_name}
                onChange={(e) => setForm({ ...form, last_name: e.target.value })}
                className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent text-sm"
              />
            </div>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="email"
                placeholder="collegue@entreprise.com"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent text-sm"
                required
              />
            </div>
            <div className="relative">
              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="tel"
                placeholder="Téléphone (optionnel)"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent text-sm"
              />
            </div>

            {mode === 'password' && (
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Mot de passe (min. 8 caractères)"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent text-sm font-mono"
                />
                <button
                  type="button"
                  onClick={generatePassword}
                  className="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-xs whitespace-nowrap"
                >
                  Générer
                </button>
              </div>
            )}

            <button
              type="submit"
              disabled={inviting || cooldown > 0}
              className="w-full flex items-center justify-center space-x-2 px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50 text-sm"
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
        </CardContent>
      </Card>

      {successToast && <Toast message={successToast} onDismiss={() => setSuccessToast(null)} />}

      <ConfirmModal
        isOpen={Boolean(memberToRemove)}
        title="Supprimer ce collaborateur"
        message="Êtes-vous sûr de vouloir supprimer ce collaborateur ? Cette action est irréversible."
        isConfirming={removing}
        error={removeError}
        onConfirm={handleConfirmRemove}
        onCancel={() => { setMemberToRemove(null); setRemoveError(null); }}
      />
    </div>
  );
};
