import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle, ArrowLeft, Check, CreditCard, KeyRound, Lock, Mail, MapPin, Phone, Shield, User, UserPlus, X,
} from 'lucide-react';
import { invokeEdgeFunction } from '../../utils/invokeEdgeFunction';
import { useGooglePlacesAutocomplete } from '../../hooks/useGooglePlacesAutocomplete';
import logo from './assets/logo_oze_paris_b2b.png';
import { PERIOD, PLANS, SUPPORT_EMAIL, type Plan, type SignupPlanId } from './plans';

/**
 * Page d'inscription au Club B2B (/inscription?pass=drops|revendeur), entre la
 * landing et le paiement Stripe. Même mise en page que la page de commande
 * du site principal (étapes, formulaire à gauche, récapitulatif collant à droite).
 *
 * Seulement l'identité, le mot de passe (choisi ici : aucun email
 * d'invitation) et l'adresse de FACTURATION : le statut juridique et
 * les infos d'entreprise se déclarent ensuite dans « Mon profil » (requis
 * pour acheter ou enchérir), l'adresse de livraison à chaque demande
 * d'expédition.
 *
 * À l'envoi : l'Edge Function b2b-signup refuse un email déjà utilisé, crée le
 * compte (en attente) puis renvoie l'URL de la session Stripe ; le webhook
 * active le compte une fois le paiement confirmé (0167).
 *
 * /inscription/merci : retour après paiement ; ?paiement=annule : retour
 * après abandon du paiement (le compte existe déjà, à finaliser en se connectant).
 */

type FormData = {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  billing_address: string;
  billing_postal_code: string;
  billing_city: string;
  billing_country: string;
  password: string;
  password_confirm: string;
};

const EMPTY: FormData = {
  first_name: '', last_name: '', email: '', phone: '',
  billing_address: '', billing_postal_code: '', billing_city: '', billing_country: 'France',
  password: '', password_confirm: '',
};

const COUNTRIES = ['France', 'Belgique', 'Suisse', 'Luxembourg', 'Monaco', 'Allemagne', 'Italie', 'Espagne', 'Royaume-Uni', 'Autre'];

// Brouillon conservé dans l'onglet : si le visiteur revient de Stripe sans
// payer, il retrouve ses informations.
const DRAFT_KEY = 'oze-b2b-signup-draft';

const SIGNUP_PLANS = PLANS.filter((p): p is Plan & { id: SignupPlanId } => p.id === 'drops' || p.id === 'revendeur');

const readPlanFromUrl = (): SignupPlanId => {
  const pass = new URLSearchParams(window.location.search).get('pass');
  return pass === 'drops' ? 'drops' : 'revendeur';
};

const validate = (f: FormData, termsAccepted: boolean) => {
  const e: Partial<Record<keyof FormData | 'terms', string>> = {};
  if (!f.first_name.trim()) e.first_name = 'Prénom requis';
  if (!f.last_name.trim()) e.last_name = 'Nom requis';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim())) e.email = 'Email invalide';
  if (f.phone.replace(/\D/g, '').length < 6) e.phone = 'Téléphone invalide';
  if (!f.billing_address.trim()) e.billing_address = 'Adresse requise';
  if (!f.billing_postal_code.trim()) e.billing_postal_code = 'Code postal requis';
  if (!f.billing_city.trim()) e.billing_city = 'Ville requise';
  if (f.password.length < 8) e.password = '8 caractères minimum';
  if (f.password_confirm !== f.password) e.password_confirm = 'Les mots de passe ne correspondent pas';
  if (!termsAccepted) e.terms = 'Veuillez accepter les conditions générales de vente';
  return e;
};

const Field: React.FC<{
  label: string;
  icon?: React.ElementType;
  error?: string;
  children: (className: string) => React.ReactNode;
}> = ({ label, icon: Icon, error, children }) => (
  <div>
    <label className="mb-1.5 block text-xs font-medium text-gray-700">
      {label} <span className="text-red-500">*</span>
    </label>
    <div className="relative">
      {Icon && <Icon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />}
      {children(
        `w-full ${Icon ? 'pl-9' : 'pl-3'} pr-3 py-2.5 text-sm border bg-white focus:outline-none focus:border-black ${
          error ? 'border-red-500' : 'border-gray-300'
        }`
      )}
    </div>
    {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
  </div>
);

const SectionHeader: React.FC<{ n: number; title: string; subtitle: string }> = ({ n, title, subtitle }) => (
  <div className="border-b border-gray-100 p-4 sm:p-5">
    <h2 className="flex items-center text-base font-semibold text-gray-900">
      <span className="mr-2.5 flex h-6 w-6 items-center justify-center rounded-full bg-black text-xs font-medium text-white">{n}</span>
      {title}
    </h2>
    <p className="mt-1 text-xs text-gray-600 sm:text-sm">{subtitle}</p>
  </div>
);

const Header: React.FC<{ current: string }> = ({ current }) => (
  <div className="sticky top-0 z-40 border-b border-gray-200 bg-white shadow-sm">
    <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
      <div className="relative flex h-14 items-center justify-between">
        <a href="/#tarifs" className="group flex items-center text-sm text-gray-600 transition-colors hover:text-gray-900">
          <ArrowLeft className="mr-2 h-4 w-4 transition-transform group-hover:-translate-x-1" />
          <span className="hidden font-medium sm:inline">Retour aux offres</span>
        </a>
        <a href="/" className="absolute left-1/2 -translate-x-1/2" aria-label="Accueil">
          <img src={logo} alt="OZË Paris — B2B Solutions" className="h-9 w-auto" />
        </a>
        <div className="hidden items-center space-x-3 text-xs text-gray-500 sm:flex">
          <span>Offres</span>
          <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
          </svg>
          <span className="font-medium text-gray-900">{current}</span>
        </div>
      </div>
    </div>
  </div>
);

const Steps: React.FC<{ current: number }> = ({ current }) => {
  const steps = [
    { id: 1, title: 'Informations', icon: UserPlus },
    { id: 2, title: 'Paiement', icon: CreditCard },
    { id: 3, title: 'Accès', icon: KeyRound },
  ];
  return (
    <div className="mb-6 rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex items-center justify-between">
        {steps.map((step, index) => {
          const Icon = step.icon;
          const isActive = current === step.id;
          const isCompleted = current > step.id;
          return (
            <React.Fragment key={step.id}>
              <div className="flex flex-col items-center">
                <div
                  className={`flex h-9 w-9 items-center justify-center rounded-full transition-all duration-300 sm:h-10 sm:w-10 ${
                    isCompleted
                      ? 'bg-green-500 text-white shadow-lg'
                      : isActive
                        ? 'scale-110 bg-black text-white shadow-lg'
                        : 'border-2 border-gray-300 bg-gray-100 text-gray-400'
                  }`}
                >
                  {isCompleted ? <Check className="h-4 w-4 sm:h-5 sm:w-5" /> : <Icon className="h-4 w-4" />}
                </div>
                <span
                  className={`mt-2 text-xs font-medium ${
                    isActive ? 'text-black' : isCompleted ? 'text-green-600' : 'text-gray-500'
                  }`}
                >
                  {step.title}
                </span>
              </div>
              {index < steps.length - 1 && (
                <div className="mx-2 flex-1 sm:mx-4">
                  <div className="h-1 rounded-full bg-gray-200">
                    <div
                      className={`h-1 rounded-full transition-all duration-500 ${current > step.id ? 'w-full bg-green-500' : 'w-0'}`}
                    />
                  </div>
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};

const PAGE_BG = { background: 'linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)' };

/** Retour de Stripe après paiement : le compte est créé par le webhook. */
const SignupThanks: React.FC = () => {
  useEffect(() => {
    document.title = 'Bienvenue au Club B2B | OZË Paris';
    try {
      sessionStorage.removeItem(DRAFT_KEY);
    } catch {
      // stockage indisponible : rien à nettoyer
    }
  }, []);

  return (
    <div className="min-h-screen" style={PAGE_BG}>
      <Header current="Confirmation" />
      <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
        <Steps current={3} />
        <div className="rounded-xl border border-gray-200 bg-white p-6 text-center shadow-sm sm:p-8">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-500 text-white">
            <Check className="h-6 w-6" />
          </div>
          <h1 className="mt-4 text-xl font-bold text-gray-900">Paiement confirmé, bienvenue !</h1>
          <p className="mx-auto mt-2 max-w-md text-sm text-gray-600">
            Votre compte est activé : connectez-vous avec l'email et le mot de passe choisis à l'inscription.
          </p>
          <div className="mx-auto mt-6 max-w-md space-y-3 text-left text-sm text-gray-700">
            <p className="flex items-start gap-3">
              <User className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-900" />
              Une fois connecté, complétez votre statut juridique dans « Mon profil » : il est requis pour acheter.
            </p>
          </div>
          <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
            <a href="/connexion" className="inline-flex items-center justify-center bg-black px-6 py-2.5 text-sm font-medium text-white hover:bg-gray-800">
              Se connecter
            </a>
            <a href={`mailto:${SUPPORT_EMAIL}`} className="inline-flex items-center justify-center border border-gray-300 px-6 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
              Une question ? {SUPPORT_EMAIL}
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};

export const B2BSignup: React.FC = () => {
  if (window.location.pathname.replace(/\/$/, '') === '/inscription/merci') return <SignupThanks />;
  return <SignupForm />;
};

const SignupForm: React.FC = () => {
  const [planId, setPlanId] = useState<SignupPlanId>(readPlanFromUrl);
  const [form, setForm] = useState<FormData>(() => {
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      return raw ? { ...EMPTY, ...JSON.parse(raw), password: '', password_confirm: '' } : EMPTY;
    } catch {
      return EMPTY;
    }
  });
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [errors, setErrors] = useState<ReturnType<typeof validate>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Compte d'abonné déjà existant pour cet email (non payé ou résilié) : on renvoie vers la connexion.
  const [existingAccount, setExistingAccount] = useState(false);
  const paymentCancelled = new URLSearchParams(window.location.search).get('paiement') === 'annule';

  const plan = SIGNUP_PLANS.find((p) => p.id === planId)!;

  useEffect(() => {
    document.title = `Inscription — ${plan.name} | OZË Paris B2B`;
    window.history.replaceState({}, '', `/inscription?pass=${planId}${paymentCancelled ? '&paiement=annule' : ''}`);
  }, [planId, plan.name, paymentCancelled]);

  useEffect(() => {
    try {
      // Jamais le mot de passe dans le brouillon.
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ ...form, password: '', password_confirm: '' }));
    } catch {
      // stockage indisponible (navigation privée) : pas de brouillon, sans gravité
    }
  }, [form]);

  const addressRef = useRef<HTMLInputElement>(null);
  useGooglePlacesAutocomplete(addressRef, (place) => {
    setForm((prev) => ({
      ...prev,
      billing_address: place.address || prev.billing_address,
      billing_city: place.city || prev.billing_city,
      billing_postal_code: place.postal_code || prev.billing_postal_code,
      billing_country: COUNTRIES.includes(place.country) ? place.country : prev.billing_country,
    }));
  });

  const set = (key: keyof FormData) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm((prev) => ({ ...prev, [key]: e.target.value }));
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: undefined }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    const found = validate(form, termsAccepted);
    setErrors(found);
    if (Object.values(found).some(Boolean)) {
      document.querySelector('[data-signup-form]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    setSubmitting(true);
    setExistingAccount(false);
    const trimmed = Object.fromEntries(
      Object.entries(form).map(([k, v]) => [k, k.startsWith('password') ? v : v.trim()])
    ) as FormData;
    const { data, error, code } = await invokeEdgeFunction<{ url: string }>('b2b-signup', {
      plan: planId,
      first_name: trimmed.first_name,
      last_name: trimmed.last_name,
      email: trimmed.email.toLowerCase(),
      phone: trimmed.phone,
      billing_address: trimmed.billing_address,
      billing_postal_code: trimmed.billing_postal_code,
      billing_city: trimmed.billing_city,
      billing_country: trimmed.billing_country,
      password: trimmed.password,
      terms_accepted: true,
    });

    if (data?.url) {
      window.location.href = data.url;
      return;
    }

    setSubmitting(false);
    if (code === 'existing_subscriber') {
      setExistingAccount(true);
    } else if (code === 'email_taken') {
      setErrors((prev) => ({ ...prev, email: error || 'Cet email est déjà utilisé' }));
      document.querySelector('[data-signup-form]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      setSubmitError(error || `L'inscription a échoué. Réessayez ou écrivez-nous à ${SUPPORT_EMAIL}.`);
    }
  };

  return (
    <div className="min-h-screen text-sm" style={PAGE_BG}>
      <Header current="Inscription" />

      {/* Titre */}
      <div className="border-b border-gray-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-6 lg:px-8">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-xl font-bold text-gray-900 sm:text-2xl">Créer votre compte</h1>
              <p className="mt-1 text-xs text-gray-600 sm:text-sm">
                Vos coordonnées, puis le paiement sécurisé de votre pass. Votre accès est ouvert dès le paiement.
              </p>
            </div>
            <div className="hidden text-right sm:block">
              <div className="text-xs text-gray-500">{plan.name}</div>
              <div className="text-lg font-bold text-gray-900">
                {plan.price} <span className="text-xs font-normal text-gray-500">{PERIOD}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
        <Steps current={1} />

        {paymentCancelled && (
          <div className="mb-6 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
            <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0" />
            <div>
              <p className="font-semibold">Paiement non finalisé</p>
              <p className="mt-0.5 text-xs sm:text-sm">
                Votre compte a bien été créé. Connectez-vous avec votre email et votre mot de passe pour finaliser votre
                abonnement quand vous le souhaitez.
              </p>
              <a href="/connexion" className="mt-2 inline-block text-xs font-semibold underline sm:text-sm">Se connecter pour finaliser</a>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Formulaire */}
          <div className="lg:col-span-7" data-signup-form>
              <form id="signup-form" onSubmit={handleSubmit} noValidate className="space-y-5">
                {/* 1. Vous */}
                <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                  <SectionHeader n={1} title="Vos coordonnées" subtitle="Votre email sera votre identifiant de connexion." />
                  <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 sm:p-5">
                    <Field label="Prénom" icon={User} error={errors.first_name}>
                      {(cls) => <input className={cls} value={form.first_name} onChange={set('first_name')} placeholder="Prénom" autoComplete="given-name" />}
                    </Field>
                    <Field label="Nom" icon={User} error={errors.last_name}>
                      {(cls) => <input className={cls} value={form.last_name} onChange={set('last_name')} placeholder="Nom" autoComplete="family-name" />}
                    </Field>
                    <Field label="Email" icon={Mail} error={errors.email}>
                      {(cls) => <input type="email" className={cls} value={form.email} onChange={set('email')} placeholder="vous@exemple.com" autoComplete="email" />}
                    </Field>
                    <Field label="Téléphone" icon={Phone} error={errors.phone}>
                      {(cls) => <input type="tel" className={cls} value={form.phone} onChange={set('phone')} placeholder="06 12 34 56 78" autoComplete="tel" />}
                    </Field>
                  </div>
                  {existingAccount && (
                    <div className="mx-4 mb-4 flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 p-3 text-blue-900 sm:mx-5 sm:mb-5">
                      <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                      <p className="text-xs sm:text-sm">
                        Vous avez déjà un compte avec cet email.{' '}
                        <a href="/connexion" className="font-semibold underline">Connectez-vous</a> pour finaliser ou reprendre
                        votre abonnement : vous retrouverez votre espace tel que vous l'avez laissé.
                      </p>
                    </div>
                  )}
                </div>

                {/* 2. Mot de passe */}
                <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                  <SectionHeader n={2} title="Votre mot de passe" subtitle="Pour vous connecter à votre espace dès le paiement validé." />
                  <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 sm:p-5">
                    <Field label="Mot de passe" icon={Lock} error={errors.password}>
                      {(cls) => <input type="password" className={cls} value={form.password} onChange={set('password')} placeholder="8 caractères minimum" autoComplete="new-password" />}
                    </Field>
                    <Field label="Confirmation" icon={Lock} error={errors.password_confirm}>
                      {(cls) => <input type="password" className={cls} value={form.password_confirm} onChange={set('password_confirm')} placeholder="Retapez le mot de passe" autoComplete="new-password" />}
                    </Field>
                  </div>
                </div>

                {/* 3. Facturation */}
                <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                  <SectionHeader
                    n={3}
                    title="Adresse de facturation"
                    subtitle="L'adresse de livraison se choisit ensuite, à chaque demande d'expédition."
                  />
                  <div className="space-y-4 p-4 sm:p-5">
                    <Field label="Adresse" icon={MapPin} error={errors.billing_address}>
                      {(cls) => (
                        <input ref={addressRef} className={cls} value={form.billing_address} onChange={set('billing_address')} placeholder="Commencez à taper votre adresse…" autoComplete="off" />
                      )}
                    </Field>
                    <div className="grid grid-cols-2 gap-4">
                      <Field label="Code postal" error={errors.billing_postal_code}>
                        {(cls) => <input className={cls} value={form.billing_postal_code} onChange={set('billing_postal_code')} placeholder="75001" autoComplete="postal-code" />}
                      </Field>
                      <Field label="Ville" error={errors.billing_city}>
                        {(cls) => <input className={cls} value={form.billing_city} onChange={set('billing_city')} placeholder="Paris" autoComplete="address-level2" />}
                      </Field>
                    </div>
                    <Field label="Pays">
                      {(cls) => (
                        <select className={cls} value={form.billing_country} onChange={set('billing_country')}>
                          {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                      )}
                    </Field>
                  </div>
                </div>
              </form>
          </div>

          {/* Récapitulatif */}
          <div className="lg:col-span-5">
            <div className="sticky top-20">
              <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                <div className="border-b border-gray-100 p-4 sm:p-5">
                  <h3 className="text-base font-semibold text-gray-900">Récapitulatif</h3>
                </div>
                <div className="p-4 sm:p-5">
                  {(
                    <div className="mb-4 grid grid-cols-2 gap-1.5 rounded-lg bg-gray-100 p-1">
                      {SIGNUP_PLANS.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => setPlanId(p.id)}
                          className={`rounded-md py-1.5 text-xs font-medium transition-colors sm:text-sm ${
                            p.id === planId ? 'bg-white text-black shadow-sm' : 'text-gray-500 hover:text-gray-800'
                          }`}
                        >
                          {p.name}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-semibold text-gray-900">{plan.name}</p>
                      <p className="mt-0.5 text-xs text-gray-500">{plan.pitch}</p>
                    </div>
                    <div className="text-right">
                      <p className="whitespace-nowrap font-semibold text-gray-900">{plan.price}</p>
                      <p className="text-xs text-gray-500">{PERIOD}</p>
                    </div>
                  </div>
                  <ul className="mt-4 space-y-2">
                    {plan.features.map((f) => (
                      <li
                        key={f.label}
                        className={`flex items-start gap-2 text-xs sm:text-sm ${f.included ? 'text-gray-700' : 'text-gray-300 line-through'}`}
                      >
                        {f.included ? (
                          <Check className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-gray-900" strokeWidth={2.5} />
                        ) : (
                          <X className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                        )}
                        {f.label}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-5 space-y-1.5 border-t border-gray-100 pt-4">
                    <div className="flex justify-between text-xs text-gray-600 sm:text-sm">
                      <span>Engagement</span>
                      <span className="font-medium text-gray-900">Sans engagement</span>
                    </div>
                    <div className="flex justify-between text-sm font-semibold text-gray-900 sm:text-base">
                      <span>À régler aujourd'hui</span>
                      <span>{plan.price}</span>
                    </div>
                    <p className="text-xs text-gray-500">Puis {plan.price} {PERIOD}, résiliable à tout moment.</p>
                  </div>

                  {/* CGV + paiement, dans la même carte que le récapitulatif */}
                  <div className="mt-5 border-t border-gray-100 pt-4">
                    <label className="flex cursor-pointer items-start gap-3 text-xs text-gray-700 sm:text-sm">
                      <input
                        type="checkbox"
                        checked={termsAccepted}
                        onChange={(e) => {
                          setTermsAccepted(e.target.checked);
                          if (errors.terms) setErrors((prev) => ({ ...prev, terms: undefined }));
                        }}
                        className="mt-0.5 h-4 w-4 flex-shrink-0 accent-black"
                      />
                      <span>
                        J'accepte les{' '}
                        <a href="/cgv" target="_blank" rel="noopener noreferrer" className="font-medium underline hover:text-black">
                          conditions générales de vente B2B
                        </a>{' '}
                        et l'abonnement mensuel sans engagement, résiliable à tout moment depuis mon profil.
                      </span>
                    </label>
                    {errors.terms && <p className="mt-2 text-xs text-red-500">{errors.terms}</p>}

                    {submitError && (
                      <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{submitError}</div>
                    )}

                    <button
                      type="submit"
                      form="signup-form"
                      disabled={submitting}
                      className="mt-5 flex w-full items-center justify-center gap-2 bg-black py-3 font-medium text-white transition-colors hover:bg-gray-800 disabled:opacity-60"
                    >
                      {submitting ? (
                        <>
                          <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                          Enregistrement…
                        </>
                      ) : (
                        <>
                          <CreditCard className="h-4 w-4" /> S'abonner et payer — {plan.price} {PERIOD}
                        </>
                      )}
                    </button>
                    <p className="mt-2.5 text-center text-xs text-gray-500">
                      Vous allez être redirigé vers Stripe pour régler votre abonnement.
                    </p>
                  </div>
                </div>
              </div>

              {/* Sécurité, collé sous le récapitulatif */}
              <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-4">
                <div className="flex items-center">
                  <Shield className="mr-2 h-4 w-4 flex-shrink-0 text-blue-600" />
                  <span className="text-sm font-semibold text-blue-900">Paiement 100 % sécurisé</span>
                </div>
                <p className="mt-1.5 text-xs text-blue-700">
                  Vos données sont protégées et le paiement est opéré par notre partenaire de confiance Stripe.
                </p>
                <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-blue-600">
                  {['SSL sécurisé', 'Données protégées', 'Stripe certifié'].map((t) => (
                    <span key={t} className="flex items-center">
                      <Check className="mr-1 h-3.5 w-3.5" /> {t}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default B2BSignup;
