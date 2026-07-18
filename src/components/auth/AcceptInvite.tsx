import React, { useEffect, useState } from 'react';
import { Lock, User, Eye, EyeOff, AlertCircle, CheckCircle, Mail, ArrowRight } from 'lucide-react';
import { supabase } from '../../lib/supabase';

// Page de destination du lien d'invitation envoyé par email (voir
// `redirectTo` dans l'Edge Function invite-reseller-contact). Le SDK
// Supabase (detectSessionInUrl + flowType 'pkce', voir lib/supabase.ts)
// consomme et décode automatiquement le token présent dans l'URL avant que
// ce composant ne s'exécute — getSession() ci-dessous attend cette étape
// interne et renvoie directement la session déjà établie, sans qu'on ait à
// parser l'URL nous-mêmes (c'est cette absence de parsing manuel qui évitait
// tout risque de bug de décodage).
type Status = 'checking' | 'ready' | 'invalid' | 'success';

const isPasswordStrongEnough = (password: string): boolean =>
  password.length >= 8 && /[a-z]/.test(password) && /[A-Z]/.test(password) && /[0-9]/.test(password);

export const AcceptInvite: React.FC = () => {
  const [status, setStatus] = useState<Status>('checking');
  const [step, setStep] = useState<'welcome' | 'details'>('welcome');
  const [invitedEmail, setInvitedEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const checkSession = async () => {
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !data.session) {
        setStatus('invalid');
        return;
      }
      const meta = data.session.user.user_metadata as { first_name?: string; last_name?: string };
      setFirstName(meta?.first_name ?? '');
      setLastName(meta?.last_name ?? '');
      setInvitedEmail(data.session.user.email ?? '');
      setStatus('ready');
    };
    checkSession();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!firstName.trim() || !lastName.trim()) {
      setError('Veuillez renseigner votre nom et votre prénom');
      return;
    }
    if (!isPasswordStrongEnough(password)) {
      setError('Le mot de passe doit contenir au moins 8 caractères, une majuscule, une minuscule et un chiffre');
      return;
    }
    if (password !== confirmPassword) {
      setError('Les deux mots de passe ne correspondent pas');
      return;
    }

    setSubmitting(true);

    const { data: userData, error: updateError } = await supabase.auth.updateUser({
      password,
      data: { first_name: firstName.trim(), last_name: lastName.trim() },
    });

    if (updateError || !userData.user) {
      setSubmitting(false);
      setError("Impossible d'activer le compte : " + (updateError?.message ?? 'erreur inconnue'));
      return;
    }

    await supabase
      .from('profiles')
      .update({ first_name: firstName.trim(), last_name: lastName.trim(), activated_at: new Date().toISOString() })
      .eq('id', userData.user.id);

    setSubmitting(false);
    setStatus('success');

    // Repart sur l'accueil pour laisser App.tsx router normalement vers
    // ResellerApp maintenant que la session est pleinement active.
    setTimeout(() => {
      window.location.href = '/';
    }, 1500);
  };

  if (status === 'checking') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-gray-900 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (status === 'invalid') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center py-12 px-4">
        <div className="max-w-md w-full bg-white rounded-lg border border-gray-100 shadow-sm p-8 text-center">
          <div className="mx-auto h-12 w-12 bg-red-50 rounded-full flex items-center justify-center mb-4">
            <AlertCircle className="h-6 w-6 text-red-600" />
          </div>
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Lien invalide</h2>
          <p className="text-sm text-gray-500 mb-6">
            Ce lien d'invitation a expiré ou n'est plus valide. Veuillez demander une nouvelle invitation à votre administrateur.
          </p>
          <button
            onClick={() => (window.location.href = '/')}
            className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors text-sm"
          >
            Retour à l'accueil
          </button>
        </div>
      </div>
    );
  }

  if (status === 'success') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center py-12 px-4">
        <div className="max-w-md w-full bg-white rounded-lg border border-gray-100 shadow-sm p-8 text-center">
          <div className="mx-auto h-12 w-12 bg-green-50 rounded-full flex items-center justify-center mb-4">
            <CheckCircle className="h-6 w-6 text-green-600" />
          </div>
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Compte activé</h2>
          <p className="text-sm text-gray-500">Redirection vers votre espace revendeur...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <div className="mx-auto h-16 w-16 bg-gray-900 rounded-full flex items-center justify-center">
            <Lock className="h-8 w-8 text-white" />
          </div>
          <h2 className="mt-6 text-3xl font-bold text-gray-900">OZË Paris</h2>
          <p className="mt-2 text-sm text-gray-600">Activez votre accès à l'espace professionnel</p>
        </div>

        <div className="flex items-center justify-center gap-2">
          <StepDot active={step === 'welcome'} done={step === 'details'} label="1" />
          <div className={`h-0.5 w-10 ${step === 'details' ? 'bg-gray-900' : 'bg-gray-200'}`} />
          <StepDot active={step === 'details'} done={false} label="2" />
        </div>

        {step === 'welcome' ? (
          <div className="bg-white rounded-lg border border-gray-100 shadow-sm p-8 text-center space-y-4">
            <div className="mx-auto h-12 w-12 bg-green-50 rounded-full flex items-center justify-center">
              <CheckCircle className="h-6 w-6 text-green-600" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-1">Invitation vérifiée</h3>
              <p className="text-sm text-gray-500">Votre adresse email a bien été confirmée :</p>
            </div>
            <div className="flex items-center justify-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-4 py-3">
              <Mail className="h-4 w-4 text-gray-400 flex-shrink-0" />
              <span className="text-sm font-medium text-gray-900 break-all">{invitedEmail}</span>
            </div>
            <button
              type="button"
              onClick={() => setStep('details')}
              className="group w-full flex items-center justify-center gap-2 py-3 px-4 border border-transparent text-sm font-medium rounded-lg text-white bg-gray-900 hover:bg-gray-800 transition-colors"
            >
              Continuer
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </button>
          </div>
        ) : (
        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="firstName" className="block text-sm font-medium text-gray-700 mb-2">
                  Prénom
                </label>
                <input
                  id="firstName"
                  type="text"
                  required
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className="block w-full px-3 py-3 border border-gray-200 rounded-lg focus:outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-400 text-sm"
                  placeholder="Prénom"
                />
              </div>
              <div>
                <label htmlFor="lastName" className="block text-sm font-medium text-gray-700 mb-2">
                  Nom
                </label>
                <input
                  id="lastName"
                  type="text"
                  required
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className="block w-full px-3 py-3 border border-gray-200 rounded-lg focus:outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-400 text-sm"
                  placeholder="Nom"
                />
              </div>
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
                Choisissez un mot de passe
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Lock className="h-5 w-5 text-gray-400" />
                </div>
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="block w-full pl-10 pr-12 py-3 border border-gray-200 rounded-lg focus:outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-400 text-sm"
                  placeholder="Au moins 8 caractères"
                />
                <button
                  type="button"
                  className="absolute inset-y-0 right-0 pr-3 flex items-center"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? (
                    <EyeOff className="h-5 w-5 text-gray-400 hover:text-gray-600" />
                  ) : (
                    <Eye className="h-5 w-5 text-gray-400 hover:text-gray-600" />
                  )}
                </button>
              </div>
              <p className="mt-1 text-xs text-gray-400">Majuscule, minuscule et chiffre requis.</p>
            </div>

            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 mb-2">
                Confirmez le mot de passe
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <User className="h-5 w-5 text-gray-400" />
                </div>
                <input
                  id="confirmPassword"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="block w-full pl-10 pr-3 py-3 border border-gray-200 rounded-lg focus:outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-400 text-sm"
                  placeholder="Retapez le mot de passe"
                />
              </div>
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center space-x-3">
              <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="group relative w-full flex justify-center py-3 px-4 border border-transparent text-sm font-medium rounded-lg text-white bg-gray-900 hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? (
              <div className="flex items-center space-x-2">
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                <span>Activation en cours...</span>
              </div>
            ) : (
              'Activer mon compte'
            )}
          </button>

          <button
            type="button"
            onClick={() => setStep('welcome')}
            disabled={submitting}
            className="w-full text-center text-xs text-gray-400 hover:text-gray-600 disabled:opacity-50"
          >
            ← Retour
          </button>
        </form>
        )}

        <div className="text-center">
          <p className="text-xs text-gray-500">OZË PARIS</p>
        </div>
      </div>
    </div>
  );
};

const StepDot: React.FC<{ active: boolean; done: boolean; label: string }> = ({ active, done, label }) => (
  <div
    className={`h-7 w-7 rounded-full flex items-center justify-center text-xs font-medium ${
      done ? 'bg-green-500 text-white' : active ? 'bg-gray-900 text-white' : 'bg-gray-200 text-gray-500'
    }`}
  >
    {done ? <CheckCircle className="h-3.5 w-3.5" /> : label}
  </div>
);
