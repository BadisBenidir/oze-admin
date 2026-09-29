import React, { useState } from 'react';
import {
  ArrowRight, BadgeCheck, CalendarClock, ChevronDown, Gavel, LayoutGrid, Menu, PackageSearch,
  ShieldCheck, Truck, X, Sparkles, Check,
} from 'lucide-react';
import {
  COMPANY_LEGAL_NAME, COMPANY_SIRET, COMPANY_RCS, COMPANY_VAT_NUMBER, COMPANY_ADDRESS,
} from '../../config/legal';

/**
 * Landing page publique de pro.ozeparis.com (visiteur non connecté sur "/",
 * voir App.tsx). Aucune donnée chargée : page 100 % statique.
 *
 * Abonnement : aucun système d'abonnement n'existe encore dans l'app — le
 * bouton pointe vers un Stripe Payment Link / Checkout configuré dans
 * Vercel. Sans lien configuré, il retombe sur une demande d'accès par email
 * plutôt que d'afficher un bouton mort.
 *   VITE_B2B_SUBSCRIPTION_CHECKOUT_URL  lien Stripe (https://buy.stripe.com/...)
 *   VITE_B2B_SUBSCRIPTION_PRICE         ex. "49 €" (sinon "Sur demande")
 *   VITE_B2B_SUBSCRIPTION_PERIOD        ex. "/ mois"
 */
const CHECKOUT_URL = (import.meta.env.VITE_B2B_SUBSCRIPTION_CHECKOUT_URL as string | undefined)?.trim() || '';
const PRICE = (import.meta.env.VITE_B2B_SUBSCRIPTION_PRICE as string | undefined)?.trim() || '';
const PERIOD = (import.meta.env.VITE_B2B_SUBSCRIPTION_PERIOD as string | undefined)?.trim() || '';
const SUPPORT_EMAIL = 'contact@ozeparis.com';
const ACCESS_REQUEST_URL = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Demande d\'accès au Club B2B OZË Paris')}`;

const NAV = [
  { id: 'solutions', label: 'Solutions' },
  { id: 'encheres', label: 'Enchères' },
  { id: 'sourcing', label: 'Sourcing' },
  { id: 'tarifs', label: 'Tarifs' },
  { id: 'faq', label: 'FAQ' },
];

const PILLARS = [
  {
    id: 'catalogue',
    icon: LayoutGrid,
    title: 'Drops & Catalogue B2B',
    text: 'Nouveaux arrivages réguliers, sélection rigoureuse des grades et des états, achat à l\'unité sans quantité minimale imposée.',
  },
  {
    id: 'encheres',
    icon: Gavel,
    title: 'Enchères B2B exclusives',
    text: 'Sessions privées pour acquérir des pièces très demandées à des prix de départ compétitifs.',
  },
  {
    id: 'sourcing',
    icon: PackageSearch,
    title: 'Sourcing sur mesure',
    text: 'Vous définissez votre budget et vos pièces cibles, nous sourçons directement pour vous avec un reporting complet.',
  },
  {
    id: 'entrupy',
    icon: ShieldCheck,
    title: 'Certification Entrupy & logistique',
    text: 'Certificats d\'authenticité numériques infalsifiables et expéditions optimisées (Mondial Relay / Colissimo).',
  },
];

const STEPS = [
  { title: 'Souscrivez à votre pass revendeur', text: 'Adhésion en ligne, en quelques minutes.' },
  { title: 'Accédez au catalogue privé', text: 'Catalogue, drops et calendrier des prochaines enchères, instantanément.' },
  { title: 'Commandez, expédiez quand vous voulez', text: 'Vos pièces vous attendent : demandez une livraison groupée dès que vous le souhaitez.' },
];

const BENEFITS = [
  'Accès complet à la plateforme et aux drops',
  'Participation aux sessions d\'enchères privées',
  'Certificats Entrupy disponibles sur chaque pièce',
  'Sourcing sur mesure sur demande',
  'Support dédié',
];

const FAQ = [
  {
    q: 'Comment l\'authenticité des pièces est-elle garantie ?',
    a: 'Chaque pièce fait l\'objet d\'un contrôle d\'authenticité rigoureux avant sa mise en ligne. Vous pouvez en plus demander un certificat Entrupy : un certificat numérique d\'authenticité, infalsifiable, rattaché à la pièce.',
  },
  {
    q: 'Quels sont les délais de livraison ?',
    a: 'Vos pièces achetées sont conservées sur votre compte : vous demandez l\'expédition quand vous le souhaitez, en regroupant plusieurs articles dans un seul colis. Les délais et modalités (point relais ou domicile) sont précisés lors de la demande d\'expédition.',
  },
  {
    q: 'Quels moyens de paiement sont acceptés ?',
    a: 'Carte bancaire (paiement sécurisé Stripe), solde de votre portefeuille B2B, ou une combinaison des deux. Une commande n\'est confirmée qu\'après encaissement effectif. Les lots remportés aux enchères sont à régler sous 24h.',
  },
  {
    q: 'Quelles sont les conditions de retour et de litige ?',
    a: 'Elles dépendent du statut déclaré. Pour un professionnel, la commande est ferme et toute non-conformité doit être signalée par écrit sous 48h ouvrées après livraison. Un particulier dispose d\'un droit de rétractation de 14 jours. Le détail figure dans nos conditions générales de vente.',
  },
];

const scrollTo = (id: string) => {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

const goToLogin = () => {
  window.location.href = '/connexion';
};

const Wordmark: React.FC<{ light?: boolean }> = ({ light }) => (
  <span className={`flex items-baseline gap-2 ${light ? 'text-white' : 'text-gray-900'}`}>
    <span className="text-lg font-semibold tracking-[0.25em]">OZË PARIS</span>
    <span className={`text-[10px] font-medium tracking-[0.3em] ${light ? 'text-white/50' : 'text-gray-400'}`}>B2B</span>
  </span>
);

const SubscribeButton: React.FC<{ className?: string; label?: string }> = ({ className = '', label }) => (
  <a
    href={CHECKOUT_URL || ACCESS_REQUEST_URL}
    target={CHECKOUT_URL ? '_blank' : undefined}
    rel={CHECKOUT_URL ? 'noopener noreferrer' : undefined}
    className={`inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-medium transition-colors ${className}`}
  >
    {label || (CHECKOUT_URL ? 'Rejoindre le Club B2B' : 'Demander mon accès')}
    <ArrowRight className="h-4 w-4" />
  </a>
);

const FaqItem: React.FC<{ q: string; a: string }> = ({ q, a }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-gray-200">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-4 py-5 text-left"
      >
        <span className="text-sm sm:text-base font-medium text-gray-900">{q}</span>
        <ChevronDown className={`h-5 w-5 flex-shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <p className="pb-5 text-sm leading-relaxed text-gray-600">{a}</p>}
    </div>
  );
};

export const B2BLanding: React.FC = () => {
  const [menuOpen, setMenuOpen] = useState(false);

  const handleNav = (id: string) => {
    setMenuOpen(false);
    scrollTo(id);
  };

  return (
    <div className="min-h-screen bg-white text-gray-900 antialiased">
      {/* HEADER */}
      <header className="fixed inset-x-0 top-0 z-40 bg-neutral-950/90 backdrop-blur border-b border-white/10">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <button onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} aria-label="Haut de page">
            <Wordmark light />
          </button>
          <nav className="hidden lg:flex items-center gap-8">
            {NAV.map((n) => (
              <button key={n.id} onClick={() => handleNav(n.id)} className="text-sm text-white/70 hover:text-white transition-colors">
                {n.label}
              </button>
            ))}
          </nav>
          <div className="hidden lg:flex items-center gap-3">
            <button onClick={goToLogin} className="text-sm text-white/80 hover:text-white px-3 py-2 transition-colors">
              Se connecter
            </button>
            <button
              onClick={() => handleNav('tarifs')}
              className="rounded-full bg-white px-5 py-2 text-sm font-medium text-gray-900 hover:bg-gray-200 transition-colors"
            >
              Rejoindre le Club B2B
            </button>
          </div>
          <button className="lg:hidden text-white p-1" onClick={() => setMenuOpen((o) => !o)} aria-label="Menu">
            {menuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>
        {menuOpen && (
          <div className="lg:hidden border-t border-white/10 bg-neutral-950 px-4 pb-6 pt-2">
            {NAV.map((n) => (
              <button key={n.id} onClick={() => handleNav(n.id)} className="block w-full py-3 text-left text-white/80">
                {n.label}
              </button>
            ))}
            <div className="mt-4 flex flex-col gap-3">
              <button onClick={goToLogin} className="rounded-full border border-white/30 py-3 text-sm text-white">
                Se connecter
              </button>
              <button onClick={() => handleNav('tarifs')} className="rounded-full bg-white py-3 text-sm font-medium text-gray-900">
                Rejoindre le Club B2B
              </button>
            </div>
          </div>
        )}
      </header>

      {/* HERO */}
      <section className="relative overflow-hidden bg-neutral-950 pt-32 pb-20 sm:pt-40 sm:pb-28">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(255,255,255,0.08),transparent_60%)]" />
        <div className="relative mx-auto max-w-4xl px-4 text-center sm:px-6">
          <p className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/15 px-4 py-1.5 text-xs tracking-[0.2em] text-white/60 uppercase">
            <Sparkles className="h-3.5 w-3.5" /> Espace professionnel
          </p>
          <h1 className="text-3xl font-light leading-tight tracking-tight text-white sm:text-5xl md:text-6xl">
            La plateforme de sourcing luxe pour les <span className="font-semibold">revendeurs professionnels</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-white/60 sm:text-lg">
            Accédez à un inventaire exclusif de maroquinerie de seconde main vérifiée par Entrupy, participez à nos
            sessions d'enchères privées et boostez vos marges.
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <button
              onClick={() => scrollTo('tarifs')}
              className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-white px-7 py-3.5 text-sm font-medium text-gray-900 hover:bg-gray-200 transition-colors sm:w-auto"
            >
              Découvrir les offres <ArrowRight className="h-4 w-4" />
            </button>
            <button
              onClick={goToLogin}
              className="w-full rounded-full border border-white/25 px-7 py-3.5 text-sm text-white hover:bg-white/10 transition-colors sm:w-auto"
            >
              Déjà membre ? Se connecter
            </button>
          </div>
          <div className="mt-14 grid grid-cols-1 gap-4 text-sm text-white/70 sm:grid-cols-3">
            {[
              { icon: BadgeCheck, label: 'Pièces 100 % authentifiées' },
              { icon: Truck, label: 'Expédition rapide' },
              { icon: CalendarClock, label: 'Drops réguliers' },
            ].map(({ icon: Icon, label }) => (
              <div key={label} className="flex items-center justify-center gap-2">
                <Icon className="h-4 w-4 text-white" /> {label}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SOLUTIONS */}
      <section id="solutions" className="scroll-mt-20 py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="max-w-2xl">
            <p className="text-xs font-medium uppercase tracking-[0.25em] text-gray-400">Nos solutions</p>
            <h2 className="mt-3 text-2xl font-light tracking-tight sm:text-4xl">
              Tout ce dont un revendeur a besoin, <span className="font-semibold">au même endroit</span>
            </h2>
          </div>
          <div className="mt-12 grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-gray-200 bg-gray-200 sm:grid-cols-2 lg:grid-cols-4">
            {PILLARS.map(({ id, icon: Icon, title, text }) => (
              <div key={title} id={id === 'catalogue' || id === 'entrupy' ? undefined : id} className="scroll-mt-24 bg-white p-6 sm:p-8">
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-gray-900 text-white">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="mt-6 text-base font-semibold">{title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-gray-600">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* COMMENT ÇA MARCHE */}
      <section className="bg-neutral-50 py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <p className="text-xs font-medium uppercase tracking-[0.25em] text-gray-400">Comment ça marche</p>
          <h2 className="mt-3 text-2xl font-light tracking-tight sm:text-4xl">
            Trois étapes, <span className="font-semibold">zéro friction</span>
          </h2>
          <ol className="mt-12 grid grid-cols-1 gap-8 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.title} className="relative">
                <span className="text-5xl font-extralight text-gray-300">0{i + 1}</span>
                <h3 className="mt-4 text-base font-semibold">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-gray-600">{s.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* TARIFS */}
      <section id="tarifs" className="scroll-mt-20 bg-neutral-950 py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="text-center">
            <p className="text-xs font-medium uppercase tracking-[0.25em] text-white/40">Adhésion</p>
            <h2 className="mt-3 text-2xl font-light tracking-tight text-white sm:text-4xl">
              Le <span className="font-semibold">Club B2B</span> OZË Paris
            </h2>
          </div>
          <div className="mx-auto mt-12 max-w-md rounded-3xl border border-white/10 bg-white p-8 sm:p-10">
            <p className="text-sm font-medium uppercase tracking-[0.2em] text-gray-400">Pass revendeur</p>
            <p className="mt-4 flex items-baseline gap-2">
              <span className="text-4xl font-semibold tracking-tight">{PRICE || 'Sur demande'}</span>
              {PRICE && PERIOD && <span className="text-sm text-gray-500">{PERIOD}</span>}
            </p>
            <ul className="mt-8 space-y-3">
              {BENEFITS.map((b) => (
                <li key={b} className="flex items-start gap-3 text-sm text-gray-700">
                  <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-900" /> {b}
                </li>
              ))}
            </ul>
            <SubscribeButton className="mt-10 w-full bg-gray-900 text-white hover:bg-gray-800" />
            <p className="mt-4 text-center text-xs text-gray-400">
              {CHECKOUT_URL ? 'Paiement sécurisé par Stripe.' : `Réponse sous 48h — ${SUPPORT_EMAIL}`}
            </p>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="scroll-mt-20 py-20 sm:py-28">
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          <p className="text-xs font-medium uppercase tracking-[0.25em] text-gray-400">Questions fréquentes</p>
          <h2 className="mt-3 text-2xl font-light tracking-tight sm:text-4xl">
            Achetez <span className="font-semibold">en confiance</span>
          </h2>
          <div className="mt-10 border-t border-gray-200">
            {FAQ.map((f) => <FaqItem key={f.q} q={f.q} a={f.a} />)}
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="bg-neutral-950 py-12 text-white/60">
        <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 sm:px-6 md:flex-row md:items-start md:justify-between">
          <div>
            <Wordmark light />
            <p className="mt-3 max-w-sm text-xs leading-relaxed text-white/40">
              {COMPANY_LEGAL_NAME} — SIRET {COMPANY_SIRET} — {COMPANY_RCS} — TVA {COMPANY_VAT_NUMBER} — {COMPANY_ADDRESS}
            </p>
          </div>
          <div className="flex flex-col gap-2 text-sm">
            <a href="/cgv" className="hover:text-white transition-colors">Conditions générales de vente B2B</a>
            <a href="/cgv" className="hover:text-white transition-colors">Mentions légales</a>
            <a href={`mailto:${SUPPORT_EMAIL}`} className="hover:text-white transition-colors">Contact support — {SUPPORT_EMAIL}</a>
          </div>
        </div>
        <p className="mx-auto mt-10 max-w-6xl px-4 text-xs text-white/30 sm:px-6">© {new Date().getFullYear()} OZË Paris. Tous droits réservés.</p>
      </footer>
    </div>
  );
};

export default B2BLanding;
