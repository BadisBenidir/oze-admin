import React, { useState, useEffect } from 'react';
import { Card, CardContent } from '../../ui/Card';
import { useResellerAuth } from '../../../hooks/useResellerAuth';
import { supabase } from '../../../lib/supabase';
import { Building2, CheckCircle2, AlertCircle, Lock, Eye, EyeOff, Check, Circle } from 'lucide-react';

export const ResellerProfile: React.FC = () => {
  const { profile } = useResellerAuth();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (profile) {
      setFirstName(profile.first_name);
      setLastName(profile.last_name);
    }
  }, [profile]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;

    setSaving(true);
    setError(null);
    setSuccess(false);

    const { error: updateError } = await supabase
      .from('profiles')
      .update({ first_name: firstName.trim(), last_name: lastName.trim() })
      .eq('id', profile.id);

    setSaving(false);
    if (updateError) {
      setError(updateError.message);
    } else {
      setSuccess(true);
    }
  };

  if (!profile) return null;

  return (
    <div className="p-4 md:p-6 max-w-lg">
      <h3 className="text-lg font-semibold text-gray-900 mb-6">Mon profil</h3>

      <Card className="mb-6">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm text-gray-700">
            <Building2 className="h-4 w-4 text-gray-400" />
            <span className="font-medium">{profile.company_name}</span>
          </div>
        </CardContent>
      </Card>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-3 flex items-center space-x-2">
          <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {success && (
        <div className="mb-4 bg-green-50 border border-green-200 rounded-lg p-3 flex items-center space-x-2">
          <CheckCircle2 className="h-4 w-4 text-green-600 flex-shrink-0" />
          <p className="text-sm text-green-700">Profil mis à jour</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Prénom</label>
            <input
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nom</label>
            <input
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent"
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
          <input
            type="email"
            value={profile.email}
            disabled
            className="w-full px-3 py-2 border border-gray-200 rounded-lg bg-gray-50 text-gray-500"
          />
        </div>
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50 text-sm"
        >
          {saving ? 'Enregistrement...' : 'Enregistrer'}
        </button>
      </form>

      <SecuritySection email={profile.email} />
    </div>
  );
};

// ---------------------------------------------------------------------------
// Sécurité — changement de mot de passe
// ---------------------------------------------------------------------------

const PASSWORD_REQUIREMENTS: { label: string; test: (password: string) => boolean }[] = [
  { label: 'Au moins 8 caractères', test: (p) => p.length >= 8 },
  { label: 'Une majuscule', test: (p) => /[A-Z]/.test(p) },
  { label: 'Une minuscule', test: (p) => /[a-z]/.test(p) },
  { label: 'Un chiffre', test: (p) => /[0-9]/.test(p) },
];

const isPasswordStrongEnough = (password: string): boolean => PASSWORD_REQUIREMENTS.every((r) => r.test(password));

interface SecuritySectionProps {
  email: string;
}

const SecuritySection: React.FC<SecuritySectionProps> = ({ email }) => {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const passwordsMatch = confirmPassword.length > 0 && newPassword === confirmPassword;
  const newPasswordValid = isPasswordStrongEnough(newPassword);
  const canSubmit =
    currentPassword.length > 0 && newPasswordValid && passwordsMatch && newPassword !== currentPassword;

  const resetForm = () => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (!currentPassword) {
      setError('Veuillez renseigner votre mot de passe actuel');
      return;
    }
    if (!newPasswordValid) {
      setError('Le nouveau mot de passe ne respecte pas les critères ci-dessous');
      return;
    }
    if (!passwordsMatch) {
      setError('Les deux mots de passe ne correspondent pas');
      return;
    }
    if (newPassword === currentPassword) {
      setError("Le nouveau mot de passe doit être différent de l'actuel");
      return;
    }

    setSubmitting(true);

    // Supabase n'expose pas de vérification de mot de passe isolée côté
    // client : on ré-authentifie avec l'email + le mot de passe actuel pour
    // le confirmer avant d'appliquer le changement.
    const { error: verifyError } = await supabase.auth.signInWithPassword({
      email,
      password: currentPassword,
    });

    if (verifyError) {
      setSubmitting(false);
      setError('Mot de passe actuel incorrect');
      return;
    }

    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });

    setSubmitting(false);

    if (updateError) {
      setError("Impossible de mettre à jour le mot de passe : " + updateError.message);
      return;
    }

    setSuccess(true);
    resetForm();
  };

  return (
    <div className="mt-8 pt-8 border-t border-gray-200">
      <h3 className="text-lg font-semibold text-gray-900 mb-1">Sécurité</h3>
      <p className="text-sm text-gray-500 mb-6">Modifiez le mot de passe de votre compte</p>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-3 flex items-center space-x-2">
          <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {success && (
        <div className="mb-4 bg-green-50 border border-green-200 rounded-lg p-3 flex items-center space-x-2">
          <CheckCircle2 className="h-4 w-4 text-green-600 flex-shrink-0" />
          <p className="text-sm text-green-700">Mot de passe mis à jour</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Mot de passe actuel</label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type={showCurrent ? 'text' : 'password'}
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full pl-9 pr-10 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent"
              placeholder="Votre mot de passe actuel"
            />
            <button
              type="button"
              onClick={() => setShowCurrent(!showCurrent)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              tabIndex={-1}
            >
              {showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Nouveau mot de passe</label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type={showNew ? 'text' : 'password'}
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full pl-9 pr-10 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent"
              placeholder="Nouveau mot de passe"
            />
            <button
              type="button"
              onClick={() => setShowNew(!showNew)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              tabIndex={-1}
            >
              {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>

          {newPassword.length > 0 && (
            <ul className="mt-2 space-y-1">
              {PASSWORD_REQUIREMENTS.map((req) => {
                const met = req.test(newPassword);
                return (
                  <li
                    key={req.label}
                    className={`flex items-center gap-1.5 text-xs ${met ? 'text-green-600' : 'text-gray-400'}`}
                  >
                    {met ? <Check className="h-3 w-3" /> : <Circle className="h-3 w-3" />}
                    {req.label}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Confirmer le nouveau mot de passe</label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type={showNew ? 'text' : 'password'}
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className={`w-full pl-9 pr-3 py-2 border rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent ${
                confirmPassword.length > 0 && !passwordsMatch ? 'border-red-300' : 'border-gray-300'
              }`}
              placeholder="Retapez le nouveau mot de passe"
            />
          </div>
          {confirmPassword.length > 0 && (
            <p className={`mt-1.5 flex items-center gap-1.5 text-xs ${passwordsMatch ? 'text-green-600' : 'text-red-600'}`}>
              {passwordsMatch ? <Check className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
              {passwordsMatch ? 'Les mots de passe correspondent' : 'Les mots de passe ne correspondent pas'}
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={submitting || !canSubmit}
          className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
        >
          {submitting ? 'Mise à jour...' : 'Mettre à jour le mot de passe'}
        </button>
      </form>
    </div>
  );
};
