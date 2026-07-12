import React, { useState } from 'react';
import { Card, CardContent } from '../../ui/Card';
import { Badge } from '../../ui/Badge';
import { useResellerAuth } from '../../../hooks/useResellerAuth';
import { useResellerTeam } from '../../../hooks/useResellerTeam';
import { Users, UserPlus, Trash2, AlertCircle, Mail, Crown } from 'lucide-react';

const generateRandomPassword = (): string => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let result = '';
  for (let i = 0; i < 12; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
};

export const Team: React.FC = () => {
  const { profile } = useResellerAuth();
  const { members, loading, error, inviteTeammate, removeTeammate } = useResellerTeam(profile?.reseller_id);

  const [mode, setMode] = useState<'email' | 'password'>('email');
  const [form, setForm] = useState({ email: '', first_name: '', last_name: '', password: '' });
  const [inviting, setInviting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [createdCredentials, setCreatedCredentials] = useState<{ email: string; password: string } | null>(null);

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

  const generatePassword = () => setForm((f) => ({ ...f, password: generateRandomPassword() }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setCreatedCredentials(null);

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
        mode === 'password' ? form.password.trim() : undefined
      );
      if (result.success) {
        if (mode === 'password') {
          setCreatedCredentials({ email: form.email.trim(), password: form.password.trim() });
        }
        setForm({ email: '', first_name: '', last_name: '', password: '' });
      } else {
        setFormError(result.error || 'Erreur lors de la création du compte');
      }
    } finally {
      setInviting(false);
    }
  };

  const handleRemove = async (memberId: string, name: string) => {
    if (!window.confirm(`Retirer l'accès de ${name} ?`)) return;
    const result = await removeTeammate(memberId);
    if (!result.success) {
      setFormError(result.error || 'Erreur lors de la suppression');
    }
  };

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
                    {!m.is_primary && (
                      <button
                        onClick={() => handleRemove(m.id, `${m.first_name} ${m.last_name}`)}
                        className="p-1 text-gray-400 hover:text-red-600 transition-colors"
                        title="Retirer l'accès"
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
              disabled={inviting}
              className="w-full flex items-center justify-center space-x-2 px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50 text-sm"
            >
              <UserPlus className="h-4 w-4" />
              <span>{inviting ? 'Création...' : mode === 'password' ? 'Créer le compte' : "Envoyer l'invitation"}</span>
            </button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};
