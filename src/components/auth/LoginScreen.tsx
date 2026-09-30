import React, { useState } from 'react'
import { Lock, User, Eye, EyeOff, AlertCircle, KeyRound, ArrowLeft, Mail, CheckCircle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { invokeEdgeFunction } from '../../utils/invokeEdgeFunction'

type Mode = 'login' | 'forgot' | 'reset' | 'contact_admin'

const inputClass =
  'block w-full pl-10 pr-3 py-3 border border-gray-200 rounded-lg focus:outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-400 text-sm'

const ErrorBox: React.FC<{ message: string }> = ({ message }) => (
  <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center space-x-3">
    <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0" />
    <p className="text-sm text-red-700">{message}</p>
  </div>
)

const SubmitButton: React.FC<{ loading: boolean; label: string; loadingLabel: string }> = ({ loading, label, loadingLabel }) => (
  <button
    type="submit"
    disabled={loading}
    className="group relative w-full flex justify-center py-3 px-4 border border-transparent text-sm font-medium rounded-lg text-white bg-gray-900 hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
  >
    {loading ? (
      <div className="flex items-center space-x-2">
        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
        <span>{loadingLabel}</span>
      </div>
    ) : (
      label
    )}
  </button>
)

export const LoginScreen: React.FC = () => {
  const [mode, setMode] = useState<Mode>('login')
  const [formData, setFormData] = useState({ email: '', password: '' })
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  // Mot de passe oublié : code reçu par email (reseller-password-reset) + nouveau mot de passe.
  const [resetCode, setResetCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  const goTo = (next: Mode) => {
    setError('')
    setMode(next)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!formData.email || !formData.password) {
      setError('Veuillez remplir tous les champs')
      return
    }

    setLoading(true)
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: formData.email,
      password: formData.password,
    })
    setLoading(false)

    if (signInError) {
      setError('Email ou mot de passe incorrect')
    }
    // Si succès : le listener onAuthStateChange (useSessionRole) prend le
    // relais et bascule automatiquement vers l'interface admin ou revendeur.
  }

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!formData.email.trim()) {
      setError('Veuillez saisir votre adresse email')
      return
    }
    setLoading(true)
    const { data, error: err } = await invokeEdgeFunction<{ status?: string; code?: string }>('reseller-password-reset', {
      email: formData.email.trim(),
    })
    setLoading(false)
    if (err) {
      setError(err)
      return
    }
    if (data?.code === 'contact_admin') {
      goTo('contact_admin')
      return
    }
    goTo('reset')
  }

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!resetCode.trim()) {
      setError('Veuillez saisir le code reçu par email')
      return
    }
    if (newPassword.length < 8) {
      setError('Le mot de passe doit contenir au moins 8 caractères')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('Les deux mots de passe ne correspondent pas')
      return
    }

    setLoading(true)
    const { data, error: verifyError } = await supabase.auth.verifyOtp({
      email: formData.email.trim(),
      token: resetCode.trim(),
      type: 'recovery',
    })
    if (verifyError || !data.session) {
      setLoading(false)
      setError('Code invalide ou expiré. Vérifiez votre saisie ou demandez un nouveau code.')
      return
    }
    // Session ouverte par le code : on fixe le nouveau mot de passe. L'app
    // bascule ensuite d'elle-même vers l'espace (onAuthStateChange).
    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword })
    setLoading(false)
    if (updateError) {
      setError(`Mot de passe refusé : ${updateError.message}`)
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }))
  }

  const subtitle =
    mode === 'login' ? 'Connectez-vous à votre espace'
      : mode === 'forgot' ? 'Recevez un code pour choisir un nouveau mot de passe'
        : mode === 'reset' ? 'Choisissez votre nouveau mot de passe'
          : 'Réinitialisation du mot de passe'

  const emailField = (
    <div>
      <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
        Adresse email
      </label>
      <div className="relative">
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
          <User className="h-5 w-5 text-gray-400" />
        </div>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={formData.email}
          onChange={handleChange}
          className={inputClass}
          placeholder="vous@exemple.com"
        />
      </div>
    </div>
  )

  const backToLogin = (
    <button
      type="button"
      onClick={() => goTo('login')}
      className="mx-auto flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900"
    >
      <ArrowLeft className="h-4 w-4" /> Retour à la connexion
    </button>
  )

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <div className="mx-auto h-16 w-16 bg-gray-900 rounded-full flex items-center justify-center">
            {mode === 'login' ? <Lock className="h-8 w-8 text-white" /> : <KeyRound className="h-8 w-8 text-white" />}
          </div>
          <h2 className="mt-6 text-3xl font-bold text-gray-900">OZË Paris</h2>
          <p className="mt-2 text-sm text-gray-600">{subtitle}</p>
        </div>

        {mode === 'login' && (
          <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
            <div className="space-y-4">
              {emailField}

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                    Mot de passe
                  </label>
                  <button type="button" onClick={() => goTo('forgot')} className="text-xs text-gray-500 hover:text-gray-900 hover:underline">
                    Mot de passe oublié ?
                  </button>
                </div>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Lock className="h-5 w-5 text-gray-400" />
                  </div>
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    required
                    value={formData.password}
                    onChange={handleChange}
                    className="block w-full pl-10 pr-12 py-3 border border-gray-200 rounded-lg focus:outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-400 text-sm"
                    placeholder="Votre mot de passe"
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
              </div>
            </div>

            {error && <ErrorBox message={error} />}

            <SubmitButton loading={loading} label="Se connecter" loadingLabel="Connexion en cours..." />
          </form>
        )}

        {mode === 'forgot' && (
          <form className="mt-8 space-y-6" onSubmit={handleForgot}>
            {emailField}
            {error && <ErrorBox message={error} />}
            <SubmitButton loading={loading} label="Recevoir un code" loadingLabel="Envoi en cours..." />
            {backToLogin}
          </form>
        )}

        {mode === 'reset' && (
          <form className="mt-8 space-y-6" onSubmit={handleReset}>
            <div className="bg-gray-100 rounded-lg p-4 flex items-start gap-3">
              <Mail className="h-5 w-5 text-gray-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-gray-700">
                Si un compte existe pour <strong>{formData.email.trim()}</strong>, un code vient de vous être envoyé par email
                (pensez à vérifier vos spams). Il est valable une heure.
              </p>
            </div>
            <div className="space-y-4">
              <div>
                <label htmlFor="reset-code" className="block text-sm font-medium text-gray-700 mb-2">Code reçu par email</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <KeyRound className="h-5 w-5 text-gray-400" />
                  </div>
                  <input
                    id="reset-code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={resetCode}
                    onChange={(e) => setResetCode(e.target.value.replace(/\s/g, ''))}
                    className={`${inputClass} tracking-widest`}
                    placeholder="123456"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="new-password" className="block text-sm font-medium text-gray-700 mb-2">Nouveau mot de passe</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Lock className="h-5 w-5 text-gray-400" />
                  </div>
                  <input
                    id="new-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="block w-full pl-10 pr-12 py-3 border border-gray-200 rounded-lg focus:outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-400 text-sm"
                    placeholder="8 caractères minimum"
                  />
                  <button type="button" className="absolute inset-y-0 right-0 pr-3 flex items-center" onClick={() => setShowPassword(!showPassword)}>
                    {showPassword ? <EyeOff className="h-5 w-5 text-gray-400 hover:text-gray-600" /> : <Eye className="h-5 w-5 text-gray-400 hover:text-gray-600" />}
                  </button>
                </div>
              </div>
              <div>
                <label htmlFor="confirm-password" className="block text-sm font-medium text-gray-700 mb-2">Confirmer le mot de passe</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Lock className="h-5 w-5 text-gray-400" />
                  </div>
                  <input
                    id="confirm-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className={inputClass}
                  />
                </div>
              </div>
            </div>
            {error && <ErrorBox message={error} />}
            <SubmitButton loading={loading} label="Changer mon mot de passe" loadingLabel="Enregistrement..." />
            <div className="flex flex-col items-center gap-3">
              <button type="button" onClick={() => goTo('forgot')} className="text-sm text-gray-500 hover:text-gray-900 hover:underline">
                Renvoyer un code
              </button>
              {backToLogin}
            </div>
          </form>
        )}

        {mode === 'contact_admin' && (
          <div className="mt-8 space-y-6">
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-5 text-center">
              <CheckCircle className="mx-auto h-6 w-6 text-amber-600" />
              <p className="mt-3 text-sm font-semibold text-amber-900">Veuillez contacter votre administrateur.</p>
              <p className="mt-1 text-sm text-amber-800">
                Votre compte fait partie d'une entreprise ou d'un accompagnement : c'est son administrateur qui peut réinitialiser votre accès.
              </p>
            </div>
            {backToLogin}
          </div>
        )}

        <div className="text-center">
          <p className="text-xs text-gray-500">OZË PARIS</p>
        </div>
      </div>
    </div>
  )
}
