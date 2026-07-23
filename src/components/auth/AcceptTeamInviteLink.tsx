import React, { useEffect, useState } from 'react';
import { Lock, User, Eye, EyeOff, AlertCircle, CheckCircle, Mail } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { invokeEdgeFunction } from '../../utils/invokeEdgeFunction';

// Page de destination du lien d'invitation d'équipe réutilisable généré
// depuis Resellers.tsx (admin) ou Team.tsx (contact principal) — voir
// InviteLinkPanel et accept-reseller-invite-link. Contrairement à
// AcceptInvite.tsx (invitation email individuelle), ce lien est public et
// réutilisable : n'importe quel collègue muni du lien peut s'inscrire
// lui-même, sans action préalable d'un admin pour SON compte spécifique.
type PageState = 'checking' | 'ready' | 'invalid' | 'success';

const isPasswordStrongEnough = (password: string): boolean =>
  password.length >= 8 && /[a-z]/.test(password) && /[A-Z]/.test(password) && /[0-9]/.test(password);

export const AcceptTeamInviteLink: React.FC = () => {
  const token = new URLSearchParams(window.location.search).get('token') || '';

  const [pageState, setPageState] = useState<PageState>('checking');
  const [companyName, setCompanyName] = useState('');

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) {
      setPageState('invalid');
      return;
    }
    const checkToken = async () => {
      try {
        const { data, error: rpcError } = await supabase.rpc('get_reseller_invite_info', { p_token: token });
        const info = Array.isArray(data) ? data[0] : data;
        if (rpcError || !info || !info.is_valid) {
          setPageState('invalid');
          return;
        }
        setCompanyName(info.company_name);
        setPageState('ready');
      } catch {
        setPageState('invalid');
      }
    };
    checkToken();
  }, [token]);

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

    setSubmitting(true);

    const { error: acceptError } = await invokeEdgeFunction('accept-reseller-invite-link', {
      token,
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      email: email.trim(),
      password,
    });

    if (acceptError) {
      setSubmitting(false);
      setError(acceptError);
      return;
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setSubmitting(false);

    if (signInError) {
      // Compte créé malgré tout : l'utilisateur peut se connecter normalement.
      setPageState('success');
      return;
    }

    window.location.href = '/';
  };

  if (pageState === 'checking') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center py-12 px-4">
        <p className="text-sm text-gray-500">Vérification du lien d'invitation...</p>
      </div>
    );
  }

  if (pageState === 'invalid') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center py-12 px-4">
        <div className="max-w-md w-full bg-white rounded-lg border border-gray-100 shadow-sm p-8 text-center">
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Lien invalide</h2>
          <p className="text-sm text-gray-500">
            Ce lien d'invitation n'existe pas ou a été désactivé. Contacte la personne qui te l'a transmis.
          </p>
        </div>
      </div>
    );
  }

  if (pageState === 'success') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center py-12 px-4">
        <div className="max-w-md w-full bg-white rounded-lg border border-gray-100 shadow-sm p-8 text-center">
          <div className="mx-auto h-12 w-12 bg-green-50 rounded-full flex items-center justify-center mb-4">
            <CheckCircle className="h-6 w-6 text-green-600" />
          </div>
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Compte créé</h2>
          <p className="text-sm text-gray-500">Tu peux maintenant te connecter avec ton email et ton mot de passe.</p>
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
          <p className="mt-2 text-sm text-gray-600">Rejoins l'équipe {companyName}</p>
        </div>

        <form className="bg-white rounded-lg border border-gray-100 shadow-sm p-8 space-y-4" onSubmit={handleSubmit}>
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
            <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
              Email
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Mail className="h-5 w-5 text-gray-400" />
              </div>
              <input
                id="email"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="block w-full pl-10 pr-3 py-3 border border-gray-200 rounded-lg focus:outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-400 text-sm"
                placeholder="vous@entreprise.com"
              />
            </div>
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
              Choisissez un mot de passe
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <User className="h-5 w-5 text-gray-400" />
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
                <span>Création du compte...</span>
              </div>
            ) : (
              "Rejoindre l'équipe"
            )}
          </button>
        </form>

        <div className="text-center">
          <p className="text-xs text-gray-500">OZË PARIS</p>
        </div>
      </div>
    </div>
  );
};
