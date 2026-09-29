import React, { useEffect, useState } from 'react';
import {
  ArrowRight, ChevronDown, Gavel, LayoutGrid, Menu,
  ShieldCheck, X, Check, Eye,
} from 'lucide-react';
import {
  COMPANY_LEGAL_NAME, COMPANY_SIRET, COMPANY_RCS, COMPANY_VAT_NUMBER, COMPANY_ADDRESS,
} from '../../config/legal';
import heroImg from './assets/hero.webp';
import clubImg from './assets/club.webp';
import sourcingImg from './assets/sourcing.webp';
import catalogueImg from './assets/pillar-catalogue.webp';
import encheresImg from './assets/pillar-encheres.webp';
import logistiqueImg from './assets/pillar-logistique.webp';
import logoWhite from './assets/logo-white.png';
import logoBlack from './assets/logo-black.png';

/**
 * Landing page publique de pro.ozeparis.com (visiteur non connecté sur "/",
 * voir App.tsx). Aucune donnée chargée : page 100 % statique.
 *
 * Style et visuels repris du site principal (oze-storefront) : police
 * Cormorant Garamond, hero photo plein écran, header transparent qui passe
 * en blanc au scroll, boutons noirs/blancs à angles droits.
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

// Police du site principal, chargée uniquement sur la landing (l'admin garde sa police système).
const FONT_HREF = 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400;500;600;700&family=Inter:wght@400;500;600&display=swap';
const SERIF = "font-['Cormorant_Garamond',serif]";
const SANS = "font-['Inter',system-ui,sans-serif]";

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
    image: catalogueImg,
    title: 'Drops & Catalogue B2B',
    text: 'Nouveaux arrivages réguliers, sélection rigoureuse des grades et des états, achat à l\'unité sans quantité minimale imposée.',
    highlight: 'Drops réguliers',
  },
  {
    id: 'encheres',
    icon: Gavel,
    image: encheresImg,
    title: 'Enchères B2B exclusives',
    text: 'Sessions privées pour acquérir des pièces très demandées à des prix de départ compétitifs.',
    highlight: 'Sessions privées',
  },
  {
    id: 'entrupy',
    icon: ShieldCheck,
    image: logistiqueImg,
    title: 'Certification Entrupy & logistique',
    text: 'Certificats d\'authenticité numériques infalsifiables et expéditions optimisées (Mondial Relay / Colissimo).',
    highlight: '100 % authentifié',
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

const SubscribeButton: React.FC<{ className?: string; label?: string }> = ({ className = '', label }) => (
  <a
    href={CHECKOUT_URL || ACCESS_REQUEST_URL}
    target={CHECKOUT_URL ? '_blank' : undefined}
    rel={CHECKOUT_URL ? 'noopener noreferrer' : undefined}
    className={`inline-flex items-center justify-center gap-2 px-8 py-4 text-base font-medium transition-colors ${className}`}
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
        className="w-full flex items-center justify-between gap-4 py-6 text-left"
      >
        <span className="text-lg sm:text-xl font-semibold text-gray-900">{q}</span>
        <ChevronDown className={`h-5 w-5 flex-shrink-0 text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <p className={`${SANS} pb-6 text-sm leading-relaxed text-gray-600`}>{a}</p>}
    </div>
  );
};

export const B2BLanding: React.FC = () => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    if (document.querySelector(`link[href="${FONT_HREF}"]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = FONT_HREF;
    document.head.appendChild(link);
  }, []);

  // Comme sur le site principal : header transparent sur le hero, blanc une fois le hero dépassé.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > window.innerHeight - 80);
    onScroll();
    window.addEventListener('scroll', onScroll);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  const transparent = !scrolled && !menuOpen;
  const navText = transparent ? 'text-white hover:text-gray-200' : 'text-black hover:text-gray-600';

  const handleNav = (id: string) => {
    setMenuOpen(false);
    scrollTo(id);
  };

  return (
    <div className={`${SERIF} min-h-screen bg-white text-gray-900 antialiased`}>
      {/* HEADER */}
      <header
        className={`fixed inset-x-0 top-0 z-40 transition-colors duration-300 ${
          transparent ? 'bg-transparent' : 'bg-white border-b border-gray-100'
        }`}
      >
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="relative flex h-16 items-center lg:h-20">
            <button
              className={`lg:hidden -ml-2 p-2 transition-colors duration-300 ${transparent ? 'text-white' : 'text-black'}`}
              onClick={() => setMenuOpen((o) => !o)}
              aria-label="Menu"
            >
              {menuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            </button>

            <div className="absolute left-1/2 -translate-x-1/2 lg:static lg:mr-10 lg:flex lg:translate-x-0 lg:items-center">
              <button
                onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                className="flex items-center gap-2 transition-opacity hover:opacity-80"
                aria-label="Haut de page"
              >
                <img
                  src={transparent ? logoWhite : logoBlack}
                  alt="OZË Paris"
                  className={`${transparent ? 'h-14' : 'h-10'} w-auto object-contain`}
                />
                <span className={`${SANS} text-[10px] font-medium tracking-[0.3em] ${transparent ? 'text-white/70' : 'text-gray-500'}`}>
                  PRO
                </span>
              </button>
            </div>

            <nav className="hidden flex-1 items-center justify-center space-x-8 lg:flex">
              {NAV.map((n) => (
                <button
                  key={n.id}
                  onClick={() => handleNav(n.id)}
                  className={`${navText} font-medium uppercase transition-colors duration-300`}
                >
                  {n.label}
                </button>
              ))}
            </nav>

            <div className="ml-auto hidden items-center gap-4 lg:flex">
              <button onClick={goToLogin} className={`${navText} font-medium transition-colors duration-300`}>
                SE CONNECTER
              </button>
              <button
                onClick={() => handleNav('tarifs')}
                className={`px-5 py-2.5 font-medium transition-colors duration-300 ${
                  transparent
                    ? 'border-2 border-white text-white hover:bg-white hover:text-black'
                    : 'bg-black text-white hover:bg-gray-900'
                }`}
              >
                Rejoindre le Club
              </button>
            </div>
          </div>
        </div>
        {menuOpen && (
          <div className="border-t border-gray-100 bg-white px-4 pb-6 pt-2 lg:hidden">
            {NAV.map((n) => (
              <button
                key={n.id}
                onClick={() => handleNav(n.id)}
                className="block w-full py-3 text-left text-lg font-medium uppercase text-black"
              >
                {n.label}
              </button>
            ))}
            <div className="mt-4 flex flex-col gap-3">
              <button onClick={goToLogin} className="border-2 border-black py-3 font-medium text-black">
                Se connecter
              </button>
              <button onClick={() => handleNav('tarifs')} className="bg-black py-3 font-medium text-white">
                Rejoindre le Club B2B
              </button>
            </div>
          </div>
        )}
      </header>

      {/* HERO */}
      <section className="relative min-h-screen overflow-hidden">
        <div className="absolute inset-0 bg-gray-900">
          <img src={heroImg} alt="" className="h-full w-full object-cover object-[70%_center]" />
        </div>
        {/* Dégradé gauche → transparent (desktop) / haut-bas (mobile) pour la lisibilité, comme le site principal */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/60 via-black/30 to-black/70 lg:hidden" />
        <div
          className="pointer-events-none absolute inset-0 hidden lg:block"
          style={{ background: 'linear-gradient(to right, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.3) 40%, rgba(0,0,0,0) 65%)' }}
        />
        <div className="relative z-10 mx-auto max-w-7xl px-4 pb-16 pt-32 lg:px-8 lg:pt-40">
          <div className="max-w-2xl">
            <span className={`${SANS} text-sm font-medium uppercase tracking-wider text-[#F5F1E8]/90`}>
              Espace professionnel
            </span>
            <h1 className="mt-4 mb-6 text-4xl font-light leading-tight text-[#FAF7F0] drop-shadow-sm md:text-5xl lg:text-6xl">
              La plateforme de sourcing luxe
              <span className="block font-bold text-white">pour les revendeurs.</span>
            </h1>
            <p className={`${SANS} mb-8 text-base leading-relaxed text-[#F5F1E8]/90 drop-shadow-sm sm:text-lg`}>
              Accédez à un inventaire exclusif de maroquinerie de seconde main vérifiée par Entrupy, participez à nos
              sessions d'enchères privées et boostez vos marges.
            </p>
            <div className="mb-12 flex flex-col gap-4 sm:flex-row">
              <button
                onClick={() => scrollTo('tarifs')}
                className="flex items-center justify-center bg-black px-8 py-4 text-base font-medium text-white transition-colors hover:bg-gray-900"
              >
                Découvrir les offres
                <ArrowRight className="ml-2 h-5 w-5" />
              </button>
              <button
                onClick={goToLogin}
                className="flex items-center justify-center border-2 border-white px-8 py-4 text-base font-medium text-white transition-colors hover:bg-white hover:text-black"
              >
                Déjà membre ? Se connecter
              </button>
            </div>
            <div className="grid grid-cols-3 gap-4 sm:gap-6">
              {[
                { value: '100%', label: 'pièces authentifiées' },
                { value: '24h', label: 'pour régler un lot' },
                { value: '0', label: 'minimum de commande' },
              ].map((s) => (
                <div key={s.label} className="border-l-2 border-white pl-3 sm:pl-4">
                  <div className="mb-1 text-2xl font-light text-white drop-shadow-sm">{s.value}</div>
                  <p className={`${SANS} text-xs text-[#F5F1E8]/90 drop-shadow-sm sm:text-sm`}>{s.label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* SOLUTIONS */}
      <section id="solutions" className="scroll-mt-20 bg-white py-16 md:py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mb-16 text-center">
            <h2 className="mb-4 text-3xl font-light text-gray-900 md:text-4xl">
              Tout ce dont un revendeur a besoin, <span className="font-bold">au même endroit</span>
            </h2>
            <p className={`${SANS} mx-auto max-w-3xl text-lg text-gray-600`}>
              Des pièces sélectionnées avec la même exigence que pour la boutique OZË Paris, réservées aux professionnels.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
            {PILLARS.map(({ id, icon: Icon, image, title, text, highlight }) => (
              <div
                key={id}
                id={id === 'encheres' ? id : undefined}
                className="group scroll-mt-24 overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm transition-shadow duration-300 hover:shadow-md"
              >
                <div className="relative h-64 overflow-hidden">
                  <img src={image} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
                  <div className="absolute left-4 top-4 flex h-12 w-12 items-center justify-center rounded-full bg-white/90 backdrop-blur-sm">
                    <Icon className="h-6 w-6 text-gray-900" />
                  </div>
                </div>
                <div className="p-6 sm:p-8">
                  <h3 className="mb-3 text-2xl font-semibold text-gray-900">{title}</h3>
                  <p className={`${SANS} mb-4 text-sm leading-relaxed text-gray-600`}>{text}</p>
                  <span className={`${SANS} inline-block rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-800`}>
                    {highlight}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SOURCING SUR MESURE (mise en page « StoryPreview » du site principal) */}
      <section id="sourcing" className="scroll-mt-20 bg-gray-50 py-16 md:py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-2">
            <div className="order-2 lg:order-1">
              <span className={`${SANS} text-sm font-medium uppercase tracking-wider text-gray-800`}>
                Sourcing sur mesure
              </span>
              <h2 className="mt-6 mb-6 text-3xl font-light leading-tight text-gray-900 md:text-4xl lg:text-5xl">
                Vos pièces cibles,
                <span className="block font-bold text-black">sourcées pour vous</span>
              </h2>
              <div className={`${SANS} space-y-6 leading-relaxed text-gray-700`}>
                <p className="text-lg">
                  Vous définissez votre budget et les modèles recherchés, nous sourçons directement pour vous.
                </p>
                <p>
                  Chaque pièce trouvée est authentifiée, facturée sur votre avance et suivie dans votre espace, avec un
                  reporting complet du budget engagé.
                </p>
              </div>
              <div className="mt-8 flex flex-col gap-4 sm:flex-row">
                <button
                  onClick={() => scrollTo('tarifs')}
                  className="flex items-center justify-center bg-gray-900 px-6 py-3 font-medium text-white transition-colors hover:bg-gray-800"
                >
                  Rejoindre le Club B2B
                  <ArrowRight className="ml-2 h-4 w-4" />
                </button>
                <a
                  href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Mission de sourcing')}`}
                  className="flex items-center justify-center border border-gray-900 px-6 py-3 font-medium text-gray-900 transition-colors hover:bg-gray-900 hover:text-white"
                >
                  Nous écrire
                </a>
              </div>
            </div>
            <div className="relative order-1 lg:order-2">
              <img
                src={sourcingImg}
                alt="Pièce de maroquinerie de luxe sourcée par OZË Paris"
                loading="lazy"
                className="h-96 w-full rounded-2xl object-cover shadow-2xl"
              />
              <div className="absolute -bottom-6 left-4 max-w-xs rounded-xl border border-gray-100 bg-white p-6 shadow-lg sm:-left-6">
                <div className="mb-3 flex items-center">
                  <Eye className="mr-2 h-5 w-5 text-gray-800" />
                  <span className="font-semibold text-gray-900">Certification Entrupy</span>
                </div>
                <p className={`${SANS} text-xs leading-relaxed text-gray-600`}>
                  Un certificat d'authenticité numérique et infalsifiable, disponible sur chaque pièce.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* COMMENT ÇA MARCHE */}
      <section className="bg-white py-16 md:py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mb-12 text-center">
            <h2 className="mb-4 text-3xl font-light text-gray-900 md:text-4xl">
              Trois étapes, <span className="font-bold">zéro friction</span>
            </h2>
          </div>
          <ol className="grid grid-cols-1 gap-8 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.title} className="rounded-xl border border-gray-100 bg-white p-8 text-center shadow-sm">
                <span className="text-5xl font-light text-gray-300">0{i + 1}</span>
                <h3 className="mt-4 mb-3 text-xl font-semibold text-gray-900">{s.title}</h3>
                <p className={`${SANS} text-sm leading-relaxed text-gray-600`}>{s.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* TARIFS */}
      <section id="tarifs" className="relative scroll-mt-20 overflow-hidden py-16 md:py-24">
        <img src={clubImg} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-0 bg-black/60" />
        <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <h2 className="text-3xl font-light text-white md:text-4xl lg:text-5xl">
              Le <span className="font-bold">Club B2B</span> OZË Paris
            </h2>
          </div>
          <div className="mx-auto mt-12 max-w-md bg-white p-8 shadow-2xl sm:p-10">
            <p className={`${SANS} text-sm font-medium uppercase tracking-wider text-gray-500`}>Pass revendeur</p>
            <p className="mt-4 flex items-baseline gap-2">
              <span className="text-5xl font-semibold">{PRICE || 'Sur demande'}</span>
              {PRICE && PERIOD && <span className={`${SANS} text-sm text-gray-500`}>{PERIOD}</span>}
            </p>
            <ul className={`${SANS} mt-8 space-y-3`}>
              {BENEFITS.map((b) => (
                <li key={b} className="flex items-start gap-3 text-sm text-gray-700">
                  <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-900" /> {b}
                </li>
              ))}
            </ul>
            <SubscribeButton className="mt-10 w-full bg-black text-white hover:bg-gray-900" />
            <p className={`${SANS} mt-4 text-center text-xs text-gray-400`}>
              {CHECKOUT_URL ? 'Paiement sécurisé par Stripe.' : `Réponse sous 48h — ${SUPPORT_EMAIL}`}
            </p>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="scroll-mt-20 bg-gray-50 py-16 md:py-20">
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          <div className="mb-10 text-center">
            <h2 className="mb-4 text-3xl font-light text-gray-900 md:text-4xl">
              Achetez <span className="font-bold">en confiance</span>
            </h2>
            <p className={`${SANS} text-lg text-gray-600`}>Les questions que se posent les revendeurs avant de nous rejoindre.</p>
          </div>
          <div className="border-t border-gray-200">
            {FAQ.map((f) => <FaqItem key={f.q} q={f.q} a={f.a} />)}
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="relative overflow-hidden bg-gradient-to-b from-gray-900 to-black text-white">
        <div className="pointer-events-none absolute inset-0 opacity-5">
          <div className="absolute left-16 top-16 h-24 w-24 rotate-45 border border-white" />
          <div className="absolute bottom-16 right-16 h-16 w-16 rotate-12 border border-white" />
          <div className="absolute left-1/3 top-1/2 h-12 w-12 rotate-45 border border-white" />
        </div>
        <div className="relative mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 gap-12 md:grid-cols-3">
            <div>
              <h3 className="mb-6 text-2xl font-bold tracking-wider">OZË PARIS <span className="font-light">PRO</span></h3>
              <p className={`${SANS} text-sm leading-relaxed text-gray-300`}>
                La plateforme de sourcing luxe réservée aux revendeurs professionnels : drops, enchères privées et
                sourcing sur mesure.
              </p>
            </div>
            <div>
              <h4 className={`${SANS} mb-6 text-lg font-semibold`}>Informations</h4>
              <ul className={`${SANS} space-y-3 text-sm`}>
                <li><a href="/cgv" className="text-gray-300 transition-colors hover:text-white">Conditions générales de vente B2B</a></li>
                <li><a href="/cgv" className="text-gray-300 transition-colors hover:text-white">Mentions légales</a></li>
                <li><button onClick={goToLogin} className="text-gray-300 transition-colors hover:text-white">Espace revendeur</button></li>
              </ul>
            </div>
            <div>
              <h4 className={`${SANS} mb-6 text-lg font-semibold`}>Contact</h4>
              <a href={`mailto:${SUPPORT_EMAIL}`} className={`${SANS} text-sm text-gray-300 transition-colors hover:text-white`}>
                {SUPPORT_EMAIL}
              </a>
            </div>
          </div>
          <div className={`${SANS} mt-12 border-t border-white/10 pt-8 text-xs text-gray-500`}>
            <p>{COMPANY_LEGAL_NAME} — SIRET {COMPANY_SIRET} — {COMPANY_RCS} — TVA {COMPANY_VAT_NUMBER} — {COMPANY_ADDRESS}</p>
            <p className="mt-2">© {new Date().getFullYear()} OZË Paris. Tous droits réservés.</p>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default B2BLanding;
