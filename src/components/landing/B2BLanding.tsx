import React, { useState } from 'react';
import {
  ArrowRight, ChevronDown, Gavel, LayoutGrid, Menu, PackageSearch, X, Check, ShieldCheck, Globe, Euro,
} from 'lucide-react';
import {
  COMPANY_LEGAL_NAME, COMPANY_SIRET, COMPANY_RCS, COMPANY_VAT_NUMBER, COMPANY_ADDRESS,
} from '../../config/legal';
import clubImg from './assets/club.webp';
import sourcingImg from './assets/sourcing.webp';
import logo from './assets/logo_oze_paris_b2b.png';

/**
 * Landing page publique de pro.ozeparis.com (visiteur non connecté sur "/",
 * voir App.tsx). Aucune donnée chargée : page 100 % statique.
 *
 * Hero sans photo pour l'instant (visuel à venir) : fond clair, texte centré.
 *
 * Abonnement : aucun système d'abonnement n'existe encore dans l'app — le
 * bouton pointe vers un Stripe Payment Link / Checkout configuré dans
 * Vercel. Sans lien configuré, il retombe sur une demande d'accès par email
 * plutôt que d'afficher un bouton mort.
 *   VITE_B2B_SUBSCRIPTION_CHECKOUT_URL  lien Stripe (https://buy.stripe.com/...)
 *   VITE_B2B_SUBSCRIPTION_PRICE         ex. "49 €" (sinon "Sur demande")
 *   VITE_B2B_SUBSCRIPTION_PERIOD        ex. "/ mois"
 *   VITE_B2B_DISCORD_URL                invitation Discord (bouton masqué si absent)
 */
const CHECKOUT_URL = (import.meta.env.VITE_B2B_SUBSCRIPTION_CHECKOUT_URL as string | undefined)?.trim() || '';
const PRICE = (import.meta.env.VITE_B2B_SUBSCRIPTION_PRICE as string | undefined)?.trim() || '';
const PERIOD = (import.meta.env.VITE_B2B_SUBSCRIPTION_PERIOD as string | undefined)?.trim() || '';
const DISCORD_URL = (import.meta.env.VITE_B2B_DISCORD_URL as string | undefined)?.trim() || '';
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
    tag: 'Catalogue',
    title: 'Drops & Catalogue B2B',
    text: 'Nouveaux arrivages réguliers, sélection rigoureuse des grades et des états, achat à l\'unité sans quantité minimale imposée.',
    points: [
      'Achat à l\'unité, sans minimum de commande',
      'Grade et état détaillés sur chaque pièce',
      'Pièces gardées sur votre compte, expédition groupée quand vous voulez',
      'Paiement par carte ou portefeuille B2B',
    ],
    featured: false,
  },
  {
    id: 'encheres',
    icon: Gavel,
    tag: 'Dès 0 €',
    title: 'Enchères B2B exclusives',
    text: 'Sessions privées réservées aux membres, avec des pièces très demandées mises en vente à partir de 0 €.',
    points: [
      'Prix de départ à 0 € sur les lots',
      'Sessions privées, entre professionnels uniquement',
      'Calendrier des prochaines sessions dans votre espace',
      'Lots remportés à régler sous 24h',
    ],
    featured: true,
  },
  {
    id: 'sourcing-sur-mesure',
    icon: PackageSearch,
    tag: 'Sur mesure',
    title: 'Sourcing sur mesure',
    text: 'Vous allouez un budget, nous sélectionnons les pièces une par une avec vous, en contact direct avec votre accompagnateur dédié.',
    points: [
      'Budget alloué selon vos objectifs',
      'Chaque pièce validée avec vous avant achat',
      'Un accompagnateur dédié, joignable en direct',
      'Reporting complet du budget engagé',
    ],
    featured: false,
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

const DiscordIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
  </svg>
);

const SubscribeButton: React.FC<{ className?: string; label?: string }> = ({ className = '', label }) => (
  <a
    href={CHECKOUT_URL || ACCESS_REQUEST_URL}
    target={CHECKOUT_URL ? '_blank' : undefined}
    rel={CHECKOUT_URL ? 'noopener noreferrer' : undefined}
    className={`inline-flex items-center justify-center gap-2 px-8 py-3.5 text-sm font-medium transition-colors ${className}`}
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
        <span className="text-base font-medium text-gray-900">{q}</span>
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
      <header className="fixed inset-x-0 top-0 z-40 border-b border-gray-100 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6 lg:h-20">
          <button onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} aria-label="Haut de page">
            <img src={logo} alt="OZË Paris — B2B Solutions" className="h-10 w-auto lg:h-12" />
          </button>
          <nav className="hidden items-center gap-8 lg:flex">
            {NAV.map((n) => (
              <button key={n.id} onClick={() => handleNav(n.id)} className="text-sm text-gray-600 transition-colors hover:text-black">
                {n.label}
              </button>
            ))}
          </nav>
          <div className="hidden items-center gap-3 lg:flex">
            <button onClick={goToLogin} className="px-3 py-2 text-sm text-gray-700 transition-colors hover:text-black">
              Se connecter
            </button>
            <button
              onClick={() => handleNav('tarifs')}
              className="bg-black px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-gray-800"
            >
              Rejoindre le Club B2B
            </button>
          </div>
          <button className="p-1 text-black lg:hidden" onClick={() => setMenuOpen((o) => !o)} aria-label="Menu">
            {menuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>
        {menuOpen && (
          <div className="border-t border-gray-100 bg-white px-4 pb-6 pt-2 lg:hidden">
            {NAV.map((n) => (
              <button key={n.id} onClick={() => handleNav(n.id)} className="block w-full py-3 text-left text-gray-800">
                {n.label}
              </button>
            ))}
            <div className="mt-4 flex flex-col gap-3">
              <button onClick={goToLogin} className="border border-gray-900 py-3 text-sm font-medium text-gray-900">
                Se connecter
              </button>
              <button onClick={() => handleNav('tarifs')} className="bg-black py-3 text-sm font-medium text-white">
                Rejoindre le Club B2B
              </button>
            </div>
          </div>
        )}
      </header>

      {/* HERO — sans photo en attendant le visuel définitif */}
      <section className="bg-neutral-50 pb-20 pt-36 sm:pb-28 sm:pt-44">
        <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
          <p className="text-xs font-medium uppercase tracking-[0.25em] text-gray-500">Espace professionnel</p>
          <h1 className="mt-5 text-3xl font-light leading-tight tracking-tight text-gray-900 sm:text-5xl">
            La plateforme de sourcing luxe pour les <span className="font-semibold">revendeurs et boutiques</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-gray-600 sm:text-lg">
            Accédez à un inventaire exclusif de maroquinerie de seconde main en direct des maisons de vente japonaises,
            participez à nos sessions d'enchères privées et boostez vos marges.
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <button
              onClick={() => scrollTo('tarifs')}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-black px-10 py-4 text-base font-semibold text-white transition-colors hover:bg-gray-800 sm:w-auto"
            >
              Découvrir les offres <ArrowRight className="h-5 w-5" />
            </button>
            {/* En dev, affiché même sans lien pour voir le rendu ; en prod, masqué tant que l'invitation n'est pas configurée */}
            {(DISCORD_URL || import.meta.env.DEV) && (
              <a
                href={DISCORD_URL || '#'}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex w-full items-center justify-center gap-3 rounded-xl bg-[#5865F2] px-10 py-4 text-base font-semibold text-white transition-colors hover:bg-[#4752C4] sm:w-auto"
              >
                <DiscordIcon className="h-5 w-5" /> Rejoindre le Discord
              </a>
            )}
          </div>
          <div className="mx-auto mt-14 grid max-w-xl grid-cols-3 divide-x divide-gray-200">
            {[
              { icon: ShieldCheck, value: '100 %', label: 'pièces authentifiées' },
              { icon: Globe, value: 'Japon', label: 'en direct des maisons de vente' },
              { icon: Euro, value: '0', label: 'minimum de commande' },
            ].map(({ icon: Icon, value, label }) => (
              <div key={label} className="px-2">
                <div className="flex items-center justify-center gap-1.5 text-2xl font-light text-gray-900">
                  <Icon className="h-5 w-5 text-gray-500" /> {value}
                </div>
                <p className="mt-1 text-xs text-gray-500">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SOLUTIONS */}
      <section id="solutions" className="scroll-mt-20 py-20 sm:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-xs font-medium uppercase tracking-[0.25em] text-gray-500">Nos solutions</p>
            <h2 className="mt-3 text-2xl font-light tracking-tight sm:text-4xl">
              Tout ce dont un revendeur a besoin, <span className="font-semibold">au même endroit</span>
            </h2>
          </div>
          <div className="mt-14 grid grid-cols-1 gap-6 lg:grid-cols-3">
            {PILLARS.map(({ id, icon: Icon, tag, title, text, points, featured }) => (
              <div
                key={id}
                id={id === 'encheres' ? id : undefined}
                className={`relative flex scroll-mt-24 flex-col rounded-3xl p-8 transition-all duration-300 hover:-translate-y-1 sm:p-10 ${
                  featured
                    ? 'bg-neutral-950 text-white shadow-2xl shadow-black/20'
                    : 'border border-gray-200 bg-white shadow-sm hover:shadow-xl'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div
                    className={`flex h-14 w-14 items-center justify-center rounded-2xl ${
                      featured ? 'bg-white text-black' : 'bg-black text-white'
                    }`}
                  >
                    <Icon className="h-7 w-7" />
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wider ${
                      featured ? 'bg-white/10 text-white' : 'bg-gray-100 text-gray-700'
                    }`}
                  >
                    {tag}
                  </span>
                </div>
                <h3 className="mt-8 text-2xl font-semibold tracking-tight">{title}</h3>
                <p className={`mt-3 text-sm leading-relaxed ${featured ? 'text-white/70' : 'text-gray-600'}`}>{text}</p>
                <div className={`my-8 h-px ${featured ? 'bg-white/10' : 'bg-gray-100'}`} />
                <ul className="flex-1 space-y-4">
                  {points.map((p) => (
                    <li key={p} className="flex items-start gap-3 text-sm">
                      <span
                        className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full ${
                          featured ? 'bg-white text-black' : 'bg-black text-white'
                        }`}
                      >
                        <Check className="h-3 w-3" strokeWidth={3} />
                      </span>
                      <span className={featured ? 'text-white/90' : 'text-gray-700'}>{p}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SOURCING SUR MESURE */}
      <section id="sourcing" className="scroll-mt-20 bg-neutral-50 py-20 sm:py-24">
        <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-12 px-4 sm:px-6 lg:grid-cols-2">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.25em] text-gray-500">Sourcing sur mesure</p>
            <h2 className="mt-3 text-2xl font-light tracking-tight sm:text-4xl">
              Vos pièces cibles, <span className="font-semibold">sourcées pour vous</span>
            </h2>
            <p className="mt-6 text-base leading-relaxed text-gray-600">
              Vous nous confiez un budget et vos modèles cibles. Un accompagnateur dédié, joignable en direct, sélectionne
              avec vous chaque pièce, une par une, avant achat. Tout est suivi dans votre espace, avec un reporting
              complet du budget engagé.
            </p>
            <a
              href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Mission de sourcing')}`}
              className="mt-8 inline-flex items-center gap-2 border border-gray-900 px-6 py-3 text-sm font-medium text-gray-900 transition-colors hover:bg-gray-900 hover:text-white"
            >
              Lancer une mission <ArrowRight className="h-4 w-4" />
            </a>
          </div>
          <img src={sourcingImg} alt="" loading="lazy" className="h-80 w-full object-cover sm:h-96" />
        </div>
      </section>

      {/* COMMENT ÇA MARCHE */}
      <section className="py-20 sm:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="text-center">
            <p className="text-xs font-medium uppercase tracking-[0.25em] text-gray-500">Comment ça marche</p>
            <h2 className="mt-3 text-2xl font-light tracking-tight sm:text-4xl">
              Trois étapes, <span className="font-semibold">zéro friction</span>
            </h2>
          </div>
          <ol className="mt-12 grid grid-cols-1 gap-8 text-center md:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.title}>
                <span className="text-4xl font-extralight text-gray-300">0{i + 1}</span>
                <h3 className="mt-3 text-base font-semibold">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-gray-600">{s.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* TARIFS */}
      <section id="tarifs" className="relative scroll-mt-20 overflow-hidden py-20 sm:py-24">
        <img src={clubImg} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-0 bg-black/65" />
        <div className="relative mx-auto max-w-6xl px-4 sm:px-6">
          <div className="text-center">
            <p className="text-xs font-medium uppercase tracking-[0.25em] text-white/60">Adhésion</p>
            <h2 className="mt-3 text-2xl font-light tracking-tight text-white sm:text-4xl">
              Le <span className="font-semibold">Club B2B</span> OZË Paris
            </h2>
          </div>
          <div className="mx-auto mt-12 max-w-md bg-white p-8 sm:p-10">
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-gray-500">Pass revendeur</p>
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
            <SubscribeButton className="mt-10 w-full bg-black text-white hover:bg-gray-800" />
            <p className="mt-4 text-center text-xs text-gray-400">
              {CHECKOUT_URL ? 'Paiement sécurisé par Stripe.' : `Réponse sous 48h — ${SUPPORT_EMAIL}`}
            </p>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="scroll-mt-20 py-20 sm:py-24">
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          <div className="text-center">
            <p className="text-xs font-medium uppercase tracking-[0.25em] text-gray-500">Questions fréquentes</p>
            <h2 className="mt-3 text-2xl font-light tracking-tight sm:text-4xl">
              Achetez <span className="font-semibold">en confiance</span>
            </h2>
          </div>
          <div className="mt-10 border-t border-gray-200">
            {FAQ.map((f) => <FaqItem key={f.q} q={f.q} a={f.a} />)}
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-gray-200 bg-neutral-50 py-12">
        <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 sm:px-6 md:flex-row md:items-start md:justify-between">
          <div>
            <img src={logo} alt="OZË Paris — B2B Solutions" className="h-12 w-auto" />
            <p className="mt-4 max-w-sm text-xs leading-relaxed text-gray-500">
              {COMPANY_LEGAL_NAME} — SIRET {COMPANY_SIRET} — {COMPANY_RCS} — TVA {COMPANY_VAT_NUMBER} — {COMPANY_ADDRESS}
            </p>
          </div>
          <div className="flex flex-col gap-2 text-sm text-gray-600">
            <a href="/cgv" className="transition-colors hover:text-black">Conditions générales de vente B2B</a>
            <a href="/cgv" className="transition-colors hover:text-black">Mentions légales</a>
            <a href={`mailto:${SUPPORT_EMAIL}`} className="transition-colors hover:text-black">Contact support — {SUPPORT_EMAIL}</a>
          </div>
        </div>
        <p className="mx-auto mt-10 max-w-6xl px-4 text-xs text-gray-400 sm:px-6">© {new Date().getFullYear()} OZË Paris. Tous droits réservés.</p>
      </footer>
    </div>
  );
};

export default B2BLanding;
