import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft, Building2, Check, CreditCard, FileText, KeyRound, Mail, MapPin, Phone, Shield, User, UserPlus, X,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useGooglePlacesAutocomplete } from '../../hooks/useGooglePlacesAutocomplete';
import logo from './assets/logo_oze_paris_b2b.png';
import { PERIOD, PLANS, SUPPORT_EMAIL, type Plan, type SignupPlanId } from './plans';

/**
 * Page d'inscription au Club B2B (/inscription?pass=drops|revendeur), entre la
 * landing et le paiement Stripe. Même mise en page que la page de commande
 * du site principal (étapes, formulaire à gauche, récapitulatif collant à droite).
 *
 * À l'envoi : la demande est insérée dans b2b_signup_requests (id généré ici,
 * l'anonyme n'a pas le droit de relire la table), puis redirection vers le
 * Stripe Payment Link du pass avec client_reference_id = id de la demande et
 * l'email prérempli. Sans lien Stripe configuré, la demande est enregistrée et
 * le visiteur est recontacté.
 */

type FormData = {
  company_name: string;
  legal_id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  address: string;
  postal_code: string;
  city: string;
  country: string;
};

const EMPTY: FormData = {
  company_name: '', legal_id: '', first_name: '', last_name: '', email: '', phone: '',
  address: '', postal_code: '', city: '', country: 'France',
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
  if (!f.company_name.trim()) e.company_name = 'Raison sociale requise';
  if (!f.legal_id.trim()) e.legal_id = 'SIRET ou n° de TVA requis';
  if (!f.first_name.trim()) e.first_name = 'Prénom requis';
  if (!f.last_name.trim()) e.last_name = 'Nom requis';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim())) e.email = 'Email invalide';
  if (f.phone.replace(/\D/g, '').length < 6) e.phone = 'Téléphone invalide';
  if (!f.address.trim()) e.address = 'Adresse requise';
  if (!f.postal_code.trim()) e.postal_code = 'Code postal requis';
  if (!f.city.trim()) e.city = 'Ville requise';
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
    <label className="mb-2 block text-sm font-medium text-gray-700">
      {label} <span className="text-red-500">*</span>
    </label>
    <div className="relative">
      {Icon && <Icon className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />}
      {children(
        `w-full ${Icon ? 'pl-10' : 'pl-4'} pr-4 py-3 border bg-white focus:outline-none focus:border-black ${
          error ? 'border-red-500' : 'border-gray-300'
        }`
      )}
    </div>
    {error && <p className="mt-1 text-sm text-red-500">{error}</p>}
  </div>
);

export const B2BSignup: React.FC = () => {
  const [planId, setPlanId] = useState<SignupPlanId>(readPlanFromUrl);
  const [form, setForm] = useState<FormData>(() => {
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      return raw ? { ...EMPTY, ...JSON.parse(raw) } : EMPTY;
    } catch {
      return EMPTY;
    }
  });
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [errors, setErrors] = useState<ReturnType<typeof validate>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const plan = SIGNUP_PLANS.find((p) => p.id === planId)!;

  useEffect(() => {
    document.title = `Inscription — ${plan.name} | OZË Paris B2B`;
    window.history.replaceState({}, '', `/inscription?pass=${planId}`);
  }, [planId, plan.name]);

  useEffect(() => {
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(form));
    } catch {
      // stockage indisponible (navigation privée) : pas de brouillon, sans gravité
    }
  }, [form]);

  const addressRef = useRef<HTMLInputElement>(null);
  useGooglePlacesAutocomplete(addressRef, (place) => {
    setForm((prev) => ({
      ...prev,
      address: place.address || prev.address,
      city: place.city || prev.city,
      postal_code: place.postal_code || prev.postal_code,
      country: COUNTRIES.includes(place.country) ? place.country : prev.country,
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
    const id = crypto.randomUUID();
    const trimmed = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v.trim()])) as FormData;
    const { error } = await supabase.from('b2b_signup_requests').insert({
      id,
      plan: planId,
      ...trimmed,
      email: trimmed.email.toLowerCase(),
      terms_accepted_at: new Date().toISOString(),
    });

    // Échec d'enregistrement avec un lien Stripe configuré : on laisse quand
    // même payer (Stripe recueille l'email) plutôt que de bloquer la vente ;
    // le brouillon reste dans l'onglet. Sans lien, rien n'aurait été transmis.
    if (error && !plan.checkoutUrl) {
      setSubmitting(false);
      setSubmitError(`L'enregistrement de vos informations a échoué. Réessayez ou écrivez-nous à ${SUPPORT_EMAIL}.`);
      return;
    }

    if (plan.checkoutUrl) {
      const url = new URL(plan.checkoutUrl);
      if (!error) url.searchParams.set('client_reference_id', id);
      url.searchParams.set('prefilled_email', trimmed.email.toLowerCase());
      window.location.href = url.toString();
      return;
    }

    // Pas encore de lien Stripe pour ce pass : demande enregistrée, on recontacte.
    try {
      sessionStorage.removeItem(DRAFT_KEY);
    } catch {
      // ignoré
    }
    setSubmitting(false);
    setDone(true);
  };

  const steps = [
    { id: 1, title: 'Informations', icon: UserPlus },
    { id: 2, title: 'Paiement', icon: CreditCard },
    { id: 3, title: 'Accès', icon: KeyRound },
  ];
  const currentStep = done ? 3 : 1;

  return (
    <div className="min-h-screen" style={{ background: 'linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)' }}>
      {/* Header */}
      <div className="sticky top-0 z-40 border-b border-gray-200 bg-white shadow-sm">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="relative flex h-16 items-center justify-between">
            <a href="/#tarifs" className="group flex items-center text-gray-600 transition-colors hover:text-gray-900">
              <ArrowLeft className="mr-2 h-5 w-5 transition-transform group-hover:-translate-x-1" />
              <span className="hidden font-medium sm:inline">Retour aux offres</span>
            </a>
            <a href="/" className="absolute left-1/2 -translate-x-1/2" aria-label="Accueil">
              <img src={logo} alt="OZË Paris — B2B Solutions" className="h-10 w-auto" />
            </a>
            <div className="hidden items-center space-x-4 text-sm text-gray-500 sm:flex">
              <span>Offres</span>
              <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
              </svg>
              <span className="font-medium text-gray-900">Inscription</span>
            </div>
          </div>
        </div>
      </div>

      {/* Titre */}
      <div className="border-b border-gray-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-extrabold text-gray-900 sm:text-[2rem]">Créer votre compte revendeur</h1>
              <p className="mt-2 text-sm text-gray-600 sm:text-base">
                Quelques informations sur votre entreprise, puis le paiement sécurisé de votre pass.
              </p>
            </div>
            <div className="hidden text-right sm:block">
              <div className="text-sm text-gray-500">{plan.name}</div>
              <div className="text-2xl font-bold text-gray-900">
                {plan.price} <span className="text-sm font-normal text-gray-500">{PERIOD}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        {/* Étapes */}
        <div className="mb-6 rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:mb-8 sm:p-6">
          <div className="flex items-center justify-between">
            {steps.map((step, index) => {
              const Icon = step.icon;
              const isActive = currentStep === step.id;
              const isCompleted = currentStep > step.id;
              return (
                <React.Fragment key={step.id}>
                  <div className="flex flex-col items-center">
                    <div
                      className={`flex h-10 w-10 items-center justify-center rounded-full transition-all duration-300 sm:h-12 sm:w-12 ${
                        isCompleted
                          ? 'bg-green-500 text-white shadow-lg'
                          : isActive
                            ? 'scale-110 bg-black text-white shadow-lg'
                            : 'border-2 border-gray-300 bg-gray-100 text-gray-400'
                      }`}
                    >
                      {isCompleted ? <Check className="h-5 w-5 sm:h-6 sm:w-6" /> : <Icon className="h-4 w-4 sm:h-5 sm:w-5" />}
                    </div>
                    <span
                      className={`mt-2 text-xs font-medium sm:mt-3 sm:text-sm ${
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
                          className={`h-1 rounded-full transition-all duration-500 ${
                            currentStep > step.id ? 'w-full bg-green-500' : 'w-0'
                          }`}
                        />
                      </div>
                    </div>
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:gap-8">
          {/* Formulaire */}
          <div className="lg:col-span-7" data-signup-form>
            {done ? (
              <div className="rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-500 text-white">
                  <Check className="h-7 w-7" />
                </div>
                <h2 className="mt-5 text-xl font-semibold text-gray-900">Demande bien reçue</h2>
                <p className="mx-auto mt-2 max-w-md text-sm text-gray-600">
                  Merci {form.first_name} ! Nous revenons vers vous sous 48h à <strong>{form.email}</strong> pour finaliser
                  votre {plan.name} et activer votre accès.
                </p>
                <a
                  href="/"
                  className="mt-6 inline-flex items-center justify-center bg-black px-6 py-3 font-medium text-white transition-colors hover:bg-gray-800"
                >
                  Retour à l'accueil
                </a>
              </div>
            ) : (
              <form onSubmit={handleSubmit} noValidate className="space-y-6">
                {/* 1. Entreprise */}
                <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                  <div className="border-b border-gray-100 p-5 sm:p-6">
                    <h2 className="flex items-center text-lg font-semibold text-gray-900 sm:text-xl">
                      <span className="mr-3 flex h-8 w-8 items-center justify-center rounded-full bg-black text-sm font-medium text-white">1</span>
                      Votre entreprise
                    </h2>
                    <p className="mt-1 text-sm text-gray-600">Pour la facturation et l'ouverture de votre compte professionnel.</p>
                  </div>
                  <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2 sm:p-6">
                    <Field label="Raison sociale" icon={Building2} error={errors.company_name}>
                      {(cls) => <input className={cls} value={form.company_name} onChange={set('company_name')} placeholder="Ex. Maison Dubois SARL" autoComplete="organization" />}
                    </Field>
                    <Field label="SIRET ou n° de TVA" icon={FileText} error={errors.legal_id}>
                      {(cls) => <input className={cls} value={form.legal_id} onChange={set('legal_id')} placeholder="Ex. 123 456 789 00012" />}
                    </Field>
                  </div>
                </div>

                {/* 2. Contact */}
                <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                  <div className="border-b border-gray-100 p-5 sm:p-6">
                    <h2 className="flex items-center text-lg font-semibold text-gray-900 sm:text-xl">
                      <span className="mr-3 flex h-8 w-8 items-center justify-center rounded-full bg-black text-sm font-medium text-white">2</span>
                      Contact principal
                    </h2>
                    <p className="mt-1 text-sm text-gray-600">Cet email sera votre identifiant de connexion.</p>
                  </div>
                  <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2 sm:p-6">
                    <Field label="Prénom" icon={User} error={errors.first_name}>
                      {(cls) => <input className={cls} value={form.first_name} onChange={set('first_name')} placeholder="Prénom" autoComplete="given-name" />}
                    </Field>
                    <Field label="Nom" icon={User} error={errors.last_name}>
                      {(cls) => <input className={cls} value={form.last_name} onChange={set('last_name')} placeholder="Nom" autoComplete="family-name" />}
                    </Field>
                    <Field label="Email" icon={Mail} error={errors.email}>
                      {(cls) => <input type="email" className={cls} value={form.email} onChange={set('email')} placeholder="vous@entreprise.com" autoComplete="email" />}
                    </Field>
                    <Field label="Téléphone" icon={Phone} error={errors.phone}>
                      {(cls) => <input type="tel" className={cls} value={form.phone} onChange={set('phone')} placeholder="06 12 34 56 78" autoComplete="tel" />}
                    </Field>
                  </div>
                </div>

                {/* 3. Adresse */}
                <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                  <div className="border-b border-gray-100 p-5 sm:p-6">
                    <h2 className="flex items-center text-lg font-semibold text-gray-900 sm:text-xl">
                      <span className="mr-3 flex h-8 w-8 items-center justify-center rounded-full bg-black text-sm font-medium text-white">3</span>
                      Adresse de livraison
                    </h2>
                    <p className="mt-1 text-sm text-gray-600">Où recevoir vos pièces lors de vos demandes d'expédition.</p>
                  </div>
                  <div className="space-y-4 p-5 sm:p-6">
                    <Field label="Adresse" icon={MapPin} error={errors.address}>
                      {(cls) => (
                        <input ref={addressRef} className={cls} value={form.address} onChange={set('address')} placeholder="Commencez à taper votre adresse…" autoComplete="off" />
                      )}
                    </Field>
                    <div className="grid grid-cols-2 gap-4">
                      <Field label="Code postal" error={errors.postal_code}>
                        {(cls) => <input className={cls} value={form.postal_code} onChange={set('postal_code')} placeholder="75001" autoComplete="postal-code" />}
                      </Field>
                      <Field label="Ville" error={errors.city}>
                        {(cls) => <input className={cls} value={form.city} onChange={set('city')} placeholder="Paris" autoComplete="address-level2" />}
                      </Field>
                    </div>
                    <Field label="Pays">
                      {(cls) => (
                        <select className={cls} value={form.country} onChange={set('country')}>
                          {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                      )}
                    </Field>
                  </div>
                </div>

                {/* CGV + envoi */}
                <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
                  <label className="flex cursor-pointer items-start gap-3 text-sm text-gray-700">
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
                      et je certifie agir pour le compte d'une entreprise.
                    </span>
                  </label>
                  {errors.terms && <p className="mt-2 text-sm text-red-500">{errors.terms}</p>}

                  {submitError && (
                    <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{submitError}</div>
                  )}

                  <button
                    type="submit"
                    disabled={submitting}
                    className="mt-6 flex w-full items-center justify-center gap-2 bg-black py-3.5 font-medium text-white transition-colors hover:bg-gray-800 disabled:opacity-60"
                  >
                    {submitting ? (
                      <>
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                        Enregistrement…
                      </>
                    ) : plan.checkoutUrl ? (
                      <>
                        <CreditCard className="h-5 w-5" /> Continuer vers le paiement
                      </>
                    ) : (
                      'Envoyer ma demande'
                    )}
                  </button>
                  <p className="mt-3 text-center text-xs text-gray-500">
                    {plan.checkoutUrl
                      ? 'Vous allez être redirigé vers Stripe pour régler votre abonnement.'
                      : `Nous revenons vers vous sous 48h — ${SUPPORT_EMAIL}`}
                  </p>
                </div>
              </form>
            )}
          </div>

          {/* Récapitulatif */}
          <div className="lg:col-span-5">
            <div className="sticky top-24">
              <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                <div className="border-b border-gray-100 p-5 sm:p-6">
                  <h3 className="text-lg font-semibold text-gray-900">Récapitulatif</h3>
                </div>
                <div className="p-5 sm:p-6">
                  {!done && (
                    <div className="mb-5 grid grid-cols-2 gap-2 rounded-lg bg-gray-100 p-1">
                      {SIGNUP_PLANS.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => setPlanId(p.id)}
                          className={`rounded-md py-2 text-sm font-medium transition-colors ${
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
                      <p className="mt-1 text-sm text-gray-500">{plan.pitch}</p>
                    </div>
                    <div className="text-right">
                      <p className="whitespace-nowrap font-semibold text-gray-900">{plan.price}</p>
                      <p className="text-xs text-gray-500">{PERIOD}</p>
                    </div>
                  </div>
                  <ul className="mt-5 space-y-2.5">
                    {plan.features.map((f) => (
                      <li
                        key={f.label}
                        className={`flex items-start gap-2.5 text-sm ${f.included ? 'text-gray-700' : 'text-gray-300 line-through'}`}
                      >
                        {f.included ? (
                          <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-900" strokeWidth={2.5} />
                        ) : (
                          <X className="mt-0.5 h-4 w-4 flex-shrink-0" />
                        )}
                        {f.label}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-6 space-y-2 border-t border-gray-100 pt-5 text-sm">
                    <div className="flex justify-between text-gray-600">
                      <span>Engagement</span>
                      <span className="font-medium text-gray-900">Sans engagement</span>
                    </div>
                    <div className="flex justify-between text-base font-semibold text-gray-900">
                      <span>À régler aujourd'hui</span>
                      <span>{plan.price}</span>
                    </div>
                    <p className="text-xs text-gray-500">Puis {plan.price} {PERIOD}, résiliable à tout moment.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Sécurité */}
        <div className="mt-8 sm:mt-12">
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-5 text-center sm:p-6">
            <div className="mb-3 flex items-center justify-center">
              <Shield className="mr-3 h-6 w-6 text-blue-600" />
              <span className="text-base font-semibold text-blue-900 sm:text-lg">Paiement 100 % sécurisé</span>
            </div>
            <p className="text-sm text-blue-700">
              Vos données sont protégées et le paiement est opéré par notre partenaire de confiance Stripe.
            </p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-blue-600">
              {['SSL sécurisé', 'Données protégées', 'Stripe certifié'].map((t) => (
                <span key={t} className="flex items-center">
                  <Check className="mr-1 h-4 w-4" /> {t}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default B2BSignup;
