import React, { useEffect, useState } from 'react';
import {
  ArrowRight, ChevronDown, Gavel, LayoutGrid, Menu, PackageSearch, X, Check, ShieldCheck, Globe, Euro, UserRound, Mail,
  Wallet, Percent,
} from 'lucide-react';
import {
  COMPANY_LEGAL_NAME, COMPANY_SIRET, COMPANY_RCS, COMPANY_VAT_NUMBER, COMPANY_ADDRESS,
} from '../../config/legal';
import heroImg from './assets/hero.jpeg';
import clubImg from './assets/club.jpeg';
import dropsImg from './assets/drops.webp';
import encheresImg from './assets/encheres.webp';
import logo from './assets/logo_oze_paris_b2b.png';
import logoWhite from './assets/logo_oze_paris_b2b_white.png';
import {
  PERIOD, DISCORD_URL, WHATSAPP_NUMBER, SUPPORT_EMAIL, AGENT_URL, PLANS, signupUrl, type Plan, type SignupPlanId,
} from './plans';

/**
 * Landing page publique de pro.ozeparis.com (visiteur non connecté sur "/",
 * voir App.tsx). Aucune donnée chargée : page 100 % statique.
 *
 * Hero : photo plein écran (assets/hero.jpeg, originale non recompressée), texte blanc centré ;
 * header transparent sur la photo puis blanc au scroll, comme le site principal.
 *
 * Offres, prix et réglages Vercel : voir ./plans.ts.
 */
// Pas de lien « Tarifs » : le bouton « Rejoindre le Club » du header y mène déjà.
const NAV = [
  { id: 'solutions', label: 'Solutions' },
  { id: 'drops', label: 'Drops' },
  { id: 'encheres', label: 'Enchères' },
  { id: 'sourcing', label: 'Sourcing' },
  { id: 'faq', label: 'FAQ' },
];

// Sections détaillées (texte + aperçu). `image` : capture de la plateforme à ajouter
// dans ./assets puis importer.
// layout : 'wide' = texte centré + capture pleine largeur, 'split' = texte et capture côte à côte,
// 'text' = texte seul centré, avec ses étapes clés (`steps`).
const FEATURES: {
  id: string;
  layout: 'wide' | 'split' | 'text';
  eyebrow: string;
  title: string;
  titleBold: string;
  text: string;
  cta: { label: string; href?: string };
  image?: string;
  steps?: { title: string; text: string }[];
}[] = [
  {
    id: 'drops',
    layout: 'wide',
    eyebrow: 'Drops & Catalogue',
    title: 'Des arrivages réguliers,',
    titleBold: 'à l\'unité',
    text: 'Chaque drop met en ligne de nouvelles pièces sélectionnées, avec grade et état détaillés. Achetez à l\'unité, sans minimum : vos pièces restent sur votre compte et vous demandez une expédition groupée quand vous le souhaitez.',
    cta: { label: 'Accéder au catalogue' },
    image: dropsImg,
  },
  {
    id: 'encheres',
    layout: 'split',
    eyebrow: 'Enchères',
    title: 'Des enchères privées,',
    titleBold: 'dès 0 €',
    text: 'Des sessions réservées aux membres, entre professionnels uniquement. Les lots démarrent à 0 € : c\'est le marché qui fixe le prix. Le calendrier des prochaines sessions est visible dans votre espace, et les lots remportés se règlent sous 24h.',
    cta: { label: 'Participer aux enchères' },
    image: encheresImg,
  },
  {
    id: 'sourcing',
    layout: 'text',
    eyebrow: 'Sourcing sur mesure',
    title: 'Vos pièces cibles,',
    titleBold: 'sourcées pour vous',
    text: 'Pour les budgets importants, un accompagnement de A à Z : vous fixez l\'enveloppe et les modèles recherchés, nous chassons les pièces et vous les validez une par une avant achat.',
    // Sans href : descend vers la section d'adhésion (#tarifs), comme les autres boutons.
    cta: { label: 'Lancer une mission' },
    steps: [
      { title: 'Vous fixez le budget', text: 'Une enveloppe allouée, vos modèles cibles, vos critères de grade et d\'état.' },
      { title: 'On sélectionne avec vous', text: 'Chaque pièce repérée vous est proposée et validée une par une, avant achat.' },
      { title: 'Un accompagnateur dédié', text: 'Un interlocuteur unique, joignable en direct, et un reporting complet du budget engagé.' },
    ],
  },
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

const FAQ = [
  {
    q: 'Comment l\'authenticité des pièces est-elle garantie ?',
    short: 'L\'authenticité est-elle garantie ?',
    a: 'Chaque pièce passe par un triple contrôle : d\'abord directement dans les maisons de vente japonaises, avant la vente ; ensuite chez nos partenaires au Japon, qui nous les expédient ; enfin chez nous, dans nos locaux, à leur arrivée. Vous pouvez en plus demander un certificat Entrupy : un certificat numérique d\'authenticité, infalsifiable, rattaché à la pièce.',
  },
  {
    q: 'Comment se passent les livraisons ?',
    short: 'Comment se passent les livraisons ?',
    a: 'Vos pièces partent directement du Japon jusqu\'à nos locaux, où nous les authentifions et les contrôlons. Une fois ce contrôle terminé, elles vous attendent sur votre compte : vous demandez la livraison quand vous le souhaitez, et la réglez à ce moment-là. Vous pouvez aussi attendre que d\'autres commandes arrivent chez nous pour demander un envoi groupé, en un seul colis.',
  },
  {
    q: 'Quels moyens de paiement sont acceptés ?',
    short: 'Quels moyens de paiement ?',
    a: 'Carte bancaire (paiement sécurisé Stripe), solde de votre portefeuille B2B, ou une combinaison des deux. Le portefeuille se recharge par carte, avec 5 € offerts pour chaque tranche de 100 € rechargés. Une commande n\'est confirmée qu\'après encaissement effectif. Les lots remportés aux enchères sont à régler sous 24h.',
  },
  {
    q: 'Y a-t-il des remises pour les commandes en volume ?',
    short: 'Des remises sur le volume ?',
    a: 'Oui, elles s\'appliquent automatiquement : -5 % dès 5 articles et -10 % dès 10 articles dans une même commande. Elles se cumulent avec le bonus de recharge du portefeuille.',
  },
  {
    q: 'Que se passe-t-il si une pièce présente un défaut ?',
    short: 'Et si une pièce a un défaut ?',
    a: 'Si la pièce présente un défaut qui n\'était signalé ni sur les photos ni dans la description, le retour est entièrement à nos frais et le remboursement est immédiat, sur le solde de votre portefeuille. Un défaut visible sur les photos ou mentionné dans la description ne donne pas lieu à un retour.',
  },
  {
    q: 'Comment fonctionnent les enchères ?',
    short: 'Comment marchent les enchères ?',
    a: 'Des sessions privées, réservées aux membres du Pass Revendeur, avec des lots dès 0 €. Vous pouvez enchérir au fil de l\'eau ou définir un montant maximum : nous surenchérissons alors automatiquement pour vous, du pas minimal, uniquement si nécessaire. Une enchère placée dans les dernières minutes prolonge le lot, pour que chacun puisse répondre. Un lot remporté est à régler sous 24h.',
  },
  {
    q: 'Comment fonctionne le sourcing sur mesure ?',
    short: 'Comment marche le sourcing ?',
    a: 'Vous nous confiez un budget et les modèles que vous recherchez. Votre accompagnateur dédié, joignable en direct, repère les pièces et vous les soumet : vous validez chacune d\'elles avant achat. Tout est suivi dans votre espace, avec le détail du budget engagé.',
  },
  {
    q: 'Faut-il être professionnel pour s\'inscrire ?',
    short: 'Faut-il être professionnel ?',
    a: 'Le Club s\'adresse aux revendeurs et aux boutiques. À votre premier achat, vous déclarez votre statut dans votre profil (particulier, entreprise individuelle ou société) : il détermine les mentions légales de vos factures.',
  },
  {
    q: 'Puis-je changer de pass ou résilier ?',
    short: 'Changer de pass ou résilier ?',
    a: 'Oui, les deux pass sont sans engagement. Vous pouvez passer du Pass Drops au Pass Revendeur à tout moment depuis votre profil : seule la différence au prorata du mois en cours est prélevée. En cas de résiliation, votre accès reste ouvert jusqu\'à la fin du mois payé, et vous retrouvez votre espace intact si vous vous réabonnez.',
  },
];

const scrollTo = (id: string) => {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

const goToLogin = () => {
  window.location.href = '/connexion';
};

// Cartes produits du catalogue (exemples), recadrées au bord de la carte et toutes
// à la même taille (300×440) : photos, prix et grades tombent à la même hauteur.
const ARTICLE_IMAGES = Object.values(
  import.meta.glob<string>('./assets/articles/*.webp', { eager: true, import: 'default' })
);

/**
 * Bandeau défilant en boucle : la liste est rendue deux fois et translatée de
 * -50 %, ce qui donne un raccord invisible. Sans animation
 * (prefers-reduced-motion), le bandeau devient simplement défilable à la main.
 */
const ArticlesMarquee: React.FC = () => (
  <div
    className="oze-marquee group relative mt-8 overflow-x-hidden motion-reduce:overflow-x-auto"
    style={{
      maskImage: 'linear-gradient(to right, transparent, black 6%, black 94%, transparent)',
      WebkitMaskImage: 'linear-gradient(to right, transparent, black 6%, black 94%, transparent)',
    }}
  >
    <style>{`
      @keyframes oze-marquee { from { transform: translate3d(0, 0, 0); } to { transform: translate3d(-50%, 0, 0); } }
      .oze-marquee-track { animation: oze-marquee 60s linear infinite; will-change: transform; backface-visibility: hidden; }
      @media (prefers-reduced-motion: reduce) { .oze-marquee-track { animation: none; } }
    `}</style>
    <div className="oze-marquee-track flex w-max gap-2 sm:gap-3">
      {[...ARTICLE_IMAGES, ...ARTICLE_IMAGES].map((src, i) => (
        <img
          key={i}
          src={src}
          alt={i < ARTICLE_IMAGES.length ? 'Exemple de pièce du catalogue B2B' : ''}
          aria-hidden={i >= ARTICLE_IMAGES.length}
          // Taille fixe réservée et chargement immédiat (~300 Ko en tout) : une image qui
          // apparaît en cours de route changerait la largeur de la bande et ferait sauter l'animation.
          width={300}
          height={440}
          loading="eager"
          decoding="async"
          draggable={false}
          className="h-48 w-[131px] flex-shrink-0 rounded-xl border border-gray-200 shadow-sm sm:h-60 sm:w-[164px]"
        />
      ))}
    </div>
  </div>
);

const DiscordIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
  </svg>
);

const WhatsAppIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z" />
  </svg>
);

const PlanCard: React.FC<{ plan: Plan }> = ({ plan }) => {
  const { name, pitch, price, featured, badge, intro, features, agent } = plan;
  // Les pass souscrivables passent d'abord par /inscription (infos du compte), qui redirige ensuite vers Stripe.
  const href = agent ? AGENT_URL : signupUrl(plan.id as SignupPlanId);
  const external = agent && !!WHATSAPP_NUMBER;
  const muted = featured ? 'text-white/60' : 'text-gray-500';

  return (
    <div
      className={`relative flex flex-col rounded-2xl p-4 sm:rounded-3xl sm:p-8 ${
        featured ? 'bg-neutral-950 text-white shadow-2xl ring-1 ring-white/15 lg:-my-4 lg:py-12' : 'bg-white text-gray-900'
      }`}
    >
      {badge && (
        <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-white px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-black shadow sm:-top-3 sm:px-3 sm:py-1 sm:text-[11px]">
          {badge}
        </span>
      )}
      {/* Mobile : nom et prix sur une seule ligne ; desktop : prix en grand sous le nom */}
      <div className="flex items-baseline justify-between gap-3 sm:block">
        <p className={`text-[11px] font-semibold uppercase tracking-[0.2em] sm:text-xs ${muted}`}>{name}</p>
        <p className="flex items-baseline gap-1.5 sm:mt-4 sm:gap-2">
          <span className="text-xl font-semibold tracking-tight sm:text-4xl">
            {agent ? 'Sur devis' : price || 'Sur demande'}
          </span>
          {!agent && price && PERIOD && <span className={`text-xs sm:text-sm ${muted}`}>{PERIOD}</span>}
        </p>
      </div>
      {!agent && price && (
        <p className={`mt-0.5 text-right text-[11px] font-medium sm:mt-1 sm:text-left sm:text-xs ${featured ? 'text-white/70' : 'text-gray-500'}`}>
          Sans engagement
        </p>
      )}
      <p className={`mt-3 hidden text-sm leading-relaxed sm:block ${featured ? 'text-white/70' : 'text-gray-600'}`}>{pitch}</p>
      <div className={`my-3 h-px sm:my-6 ${featured ? 'bg-white/10' : 'bg-gray-100'}`} />
      {intro && <p className="mb-2 text-xs font-semibold sm:mb-4 sm:text-sm">{intro}</p>}
      <ul className="flex-1 space-y-1.5 sm:space-y-3">
        {features.map((f) => (
          <li
            key={f.label}
            // Mobile : les exclusions sont résumées sur une ligne sous la liste, pas une ligne chacune.
            className={`items-start gap-2 text-xs sm:gap-3 sm:text-sm ${
              f.included
                ? `flex ${featured ? 'text-white/90' : 'text-gray-700'}`
                : `hidden sm:flex ${featured ? 'text-white/30' : 'text-gray-300'} line-through`
            }`}
          >
            {f.included ? (
              <Check className={`mt-0.5 h-3.5 w-3.5 flex-shrink-0 sm:h-4 sm:w-4 ${featured ? 'text-white' : 'text-gray-900'}`} strokeWidth={2.5} />
            ) : (
              <X className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 sm:h-4 sm:w-4" />
            )}
            {f.label}
          </li>
        ))}
      </ul>
      {features.some((f) => !f.included) && (
        <p className={`mt-1.5 text-[11px] sm:hidden ${featured ? 'text-white/40' : 'text-gray-400'}`}>
          Non inclus : {features.filter((f) => !f.included).map((f) => f.label.toLowerCase()).join(', ')}
        </p>
      )}
      <a
        href={href}
        target={external ? '_blank' : undefined}
        rel={external ? 'noopener noreferrer' : undefined}
        className={`mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-xs font-semibold transition-colors sm:mt-8 sm:px-6 sm:py-3.5 sm:text-sm ${
          agent
            ? 'bg-[#25D366] text-white hover:bg-[#1EBE5A]'
            : featured
              ? 'bg-white text-black hover:bg-gray-100'
              : 'bg-black text-white hover:bg-gray-800'
        }`}
      >
        {agent ? (
          <>
            <WhatsAppIcon className="h-4 w-4 sm:h-5 sm:w-5" /> Contacter un agent
          </>
        ) : (
          <>
            {`Choisir le ${name}`} <ArrowRight className="h-4 w-4" />
          </>
        )}
      </a>
      <p className={`mt-3 hidden text-center text-xs sm:block ${featured ? 'text-white/40' : 'text-gray-400'}`}>
        {agent
          ? WHATSAPP_NUMBER ? 'Réponse rapide sur WhatsApp' : `Réponse sous 48h — ${SUPPORT_EMAIL}`
          : 'Paiement sécurisé par Stripe'}
      </p>
    </div>
  );
};

// `short` : version de la question affichée sur mobile, pensée pour tenir sur une ligne.
const FaqItem: React.FC<{ q: string; short: string; a: string }> = ({ q, short, a }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-gray-200">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 py-3.5 text-left sm:gap-4 sm:py-5"
      >
        <span className="min-w-0 text-[13px] font-medium text-gray-900 sm:text-base">
          <span className="block truncate sm:hidden">{short}</span>
          <span className="hidden sm:inline">{q}</span>
        </span>
        <ChevronDown className={`h-4 w-4 flex-shrink-0 text-gray-400 transition-transform sm:h-5 sm:w-5 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <p className="pb-3.5 text-xs leading-relaxed text-gray-600 sm:pb-5 sm:text-sm">{a}</p>}
    </div>
  );
};

export const B2BLanding: React.FC = () => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  // Comme sur le site principal : header transparent sur la photo, blanc une fois le hero (plein écran) dépassé.
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

  const handleNav = (id: string) => {
    setMenuOpen(false);
    scrollTo(id);
  };

  return (
    <div className="min-h-screen bg-white text-gray-900 antialiased">
      {/* HEADER */}
      <header
        className={`fixed inset-x-0 top-0 z-40 transition-colors duration-300 ${
          transparent ? 'border-b border-transparent bg-transparent' : 'border-b border-gray-100 bg-white'
        }`}
      >
        {/* Mobile : menu à gauche, logo centré, connexion à droite. Desktop : logo, nav, actions. */}
        <div className="relative mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6 lg:h-20">
          <button
            className={`-ml-1 p-1 lg:hidden ${transparent ? 'text-white' : 'text-black'}`}
            onClick={() => setMenuOpen((o) => !o)}
            aria-label="Menu"
          >
            {menuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
          <button
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            aria-label="Haut de page"
            className="absolute left-1/2 -translate-x-1/2 lg:static lg:translate-x-0"
          >
            <img
              src={transparent ? logoWhite : logo}
              alt="OZË Paris — B2B Solutions"
              className="h-10 w-auto lg:h-12"
            />
          </button>
          <nav className="hidden items-center gap-8 lg:flex">
            {NAV.map((n) => (
              <button
                key={n.id}
                onClick={() => handleNav(n.id)}
                className={`text-sm transition-colors ${transparent ? 'text-white/85 hover:text-white' : 'text-gray-600 hover:text-black'}`}
              >
                {n.label}
              </button>
            ))}
          </nav>
          <div className="hidden items-center gap-3 lg:flex">
            <button
              onClick={goToLogin}
              className={`px-3 py-2 text-sm transition-colors ${transparent ? 'text-white/85 hover:text-white' : 'text-gray-700 hover:text-black'}`}
            >
              Se connecter
            </button>
            <button
              onClick={() => handleNav('tarifs')}
              className={`rounded-lg px-5 py-2.5 text-sm font-medium transition-colors ${
                transparent ? 'bg-white text-black hover:bg-gray-100' : 'bg-black text-white hover:bg-gray-800'
              }`}
            >
              Rejoindre le Club
            </button>
          </div>
          <button
            className={`-mr-1 p-1 lg:hidden ${transparent ? 'text-white' : 'text-black'}`}
            onClick={goToLogin}
            aria-label="Se connecter"
          >
            <UserRound className="h-6 w-6" />
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
              <button onClick={goToLogin} className="rounded-lg border border-gray-900 py-3 text-sm font-medium text-gray-900">
                Se connecter
              </button>
              <button onClick={() => handleNav('tarifs')} className="rounded-lg bg-black py-3 text-sm font-medium text-white">
                Rejoindre le Club
              </button>
            </div>
          </div>
        )}
      </header>

      {/* HERO — photo plein écran sous le header transparent, texte centré par-dessus */}
      <section>
        <div className="relative flex min-h-screen items-center overflow-hidden bg-neutral-900 pb-16 pt-28">
        <img src={heroImg} alt="" className="absolute inset-0 h-full w-full object-cover object-[40%_100%]" />
        <div className="pointer-events-none absolute inset-0 bg-black/45" />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/50" />
        <div className="relative mx-auto max-w-3xl px-4 text-center sm:px-6">
          <p className="text-xs font-medium uppercase tracking-[0.25em] text-white/70">Espace professionnel</p>
          <h1 className="mt-5 text-3xl font-light leading-tight tracking-tight text-white drop-shadow sm:text-5xl md:text-6xl">
            La plateforme de sourcing luxe pour les <span className="font-semibold">revendeurs et boutiques</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-white/85 drop-shadow sm:text-lg">
            Accédez à un inventaire exclusif de maroquinerie de seconde main en direct des maisons de vente japonaises,
            participez à nos sessions d'enchères privées et boostez vos marges.
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <button
              onClick={() => scrollTo('tarifs')}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-white px-10 py-4 text-base font-semibold text-black transition-colors hover:bg-gray-100 sm:w-auto"
            >
              Découvrir les offres <ArrowRight className="h-5 w-5" />
            </button>
            {DISCORD_URL && (
              <a
                href={DISCORD_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex w-full items-center justify-center gap-3 rounded-xl bg-[#5865F2] px-10 py-4 text-base font-semibold text-white transition-colors hover:bg-[#4752C4] sm:w-auto"
              >
                <DiscordIcon className="h-5 w-5" /> Rejoindre le Discord
              </a>
            )}
          </div>
          <div className="mx-auto mt-14 grid max-w-xl grid-cols-3 divide-x divide-white/25">
            {[
              { icon: ShieldCheck, value: '100 %', label: 'pièces authentifiées' },
              { icon: Globe, value: 'Japon', label: 'en direct des maisons de vente' },
              { icon: Euro, value: '0', label: 'minimum de commande', iconAfter: true },
            ].map(({ icon: Icon, value, label, iconAfter }) => (
              <div key={label} className="px-2">
                <div className="flex items-center justify-center gap-1.5 text-2xl font-light leading-none text-white">
                  {!iconAfter && <Icon className="h-5 w-5 translate-y-px text-white/70" />}
                  {value}
                  {iconAfter && <Icon className="h-5 w-5 translate-y-px text-white/70" />}
                </div>
                <p className="mt-2 text-xs text-white/70">{label}</p>
              </div>
            ))}
          </div>
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
          <div className="mt-10 grid grid-cols-1 gap-4 sm:mt-14 sm:gap-6 lg:grid-cols-3">
            {PILLARS.map(({ id, icon: Icon, tag, title, text, points, featured }) => (
              <div
                key={id}
                className={`relative flex scroll-mt-24 flex-col rounded-2xl p-5 transition-all duration-300 hover:-translate-y-1 sm:rounded-3xl sm:p-10 ${
                  featured
                    ? 'bg-neutral-950 text-white shadow-2xl shadow-black/20'
                    : 'border border-gray-200 bg-white shadow-sm hover:shadow-xl'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div
                    className={`flex h-10 w-10 items-center justify-center rounded-xl sm:h-14 sm:w-14 sm:rounded-2xl ${
                      featured ? 'bg-white text-black' : 'bg-black text-white'
                    }`}
                  >
                    <Icon className="h-5 w-5 sm:h-7 sm:w-7" />
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-1 text-[10px] sm:px-3 sm:text-xs font-semibold uppercase tracking-wider ${
                      featured ? 'bg-white/10 text-white' : 'bg-gray-100 text-gray-700'
                    }`}
                  >
                    {tag}
                  </span>
                </div>
                <h3 className="mt-4 text-lg font-semibold sm:mt-8 sm:text-2xl tracking-tight">{title}</h3>
                <p className={`mt-3 hidden text-sm leading-relaxed sm:block ${featured ? 'text-white/70' : 'text-gray-600'}`}>{text}</p>
                <div className={`my-4 h-px sm:my-8 ${featured ? 'bg-white/10' : 'bg-gray-100'}`} />
                <ul className="flex-1 space-y-2.5 sm:space-y-4">
                  {points.map((p) => (
                    <li key={p} className="flex items-start gap-2.5 text-[13px] sm:gap-3 sm:text-sm">
                      <span
                        className={`mt-0.5 flex h-4 w-4 sm:h-5 sm:w-5 flex-shrink-0 items-center justify-center rounded-full ${
                          featured ? 'bg-white text-black' : 'bg-black text-white'
                        }`}
                      >
                        <Check className="h-2.5 w-2.5 sm:h-3 sm:w-3" strokeWidth={3} />
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

      {/* APERÇU DU CATALOGUE — bandeau défilant en boucle, une seule rangée */}
      <section className="overflow-hidden border-y border-gray-100 bg-white py-10 sm:py-12">
        <div className="mx-auto max-w-6xl px-4 text-center sm:px-6">
          <p className="text-xs font-medium uppercase tracking-[0.25em] text-gray-500">Un aperçu du catalogue</p>
          <h2 className="mt-2 text-xl font-light tracking-tight sm:text-2xl">
            Des pièces comme celles-ci, <span className="font-semibold">à chaque drop</span>
          </h2>
        </div>
        <ArticlesMarquee />
        <p className="mt-5 px-4 text-center text-xs text-gray-400">
          Exemples de pièces déjà proposées aux membres. Catalogue complet et prix réservés aux abonnés.
        </p>
      </section>

      {/* DÉTAIL DES 3 SOLUTIONS (cibles des liens Drops / Enchères / Sourcing du header) */}
      {FEATURES.map((f, i) => {
        const centered = f.layout !== 'split';
        const heading = (
          <>
            <p className="text-xs font-medium uppercase tracking-[0.25em] text-gray-500">{f.eyebrow}</p>
            <h2 className="mt-3 text-2xl font-light tracking-tight sm:text-4xl">
              {f.title} <span className="font-semibold">{f.titleBold}</span>
            </h2>
            <p className={`mt-6 text-base leading-relaxed text-gray-600 sm:text-lg ${centered ? 'mx-auto max-w-2xl' : ''}`}>
              {f.text}
            </p>
          </>
        );
        const ctaClass = 'inline-flex items-center gap-2 rounded-xl bg-black px-7 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-gray-800';
        const cta = f.cta.href ? (
          <a href={f.cta.href} className={ctaClass}>
            {f.cta.label} <ArrowRight className="h-4 w-4" />
          </a>
        ) : (
          <button onClick={() => scrollTo('tarifs')} className={ctaClass}>
            {f.cta.label} <ArrowRight className="h-4 w-4" />
          </button>
        );
        const screenshot = f.image && (
          <img
            src={f.image}
            alt={f.eyebrow}
            loading="lazy"
            className="w-full rounded-2xl border border-gray-200 object-cover shadow-2xl"
          />
        );

        return (
          <section
            key={f.id}
            id={f.id}
            className={`scroll-mt-20 py-20 sm:py-28 ${i % 2 === 0 ? 'bg-neutral-50' : 'bg-white'}`}
          >
            {f.layout === 'split' ? (
              <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-12 px-4 sm:px-6 lg:grid-cols-2 lg:gap-16">
                <div className="lg:order-2">
                  {heading}
                  <div className="mt-8">{cta}</div>
                </div>
                {screenshot}
              </div>
            ) : (
              <div className="mx-auto max-w-7xl px-4 text-center sm:px-6">
                {heading}
                <div className="mt-8">{cta}</div>
                {f.layout === 'wide' && screenshot && <div className="mt-14">{screenshot}</div>}
                {f.steps && (
                  <ol className="mx-auto mt-8 grid max-w-5xl grid-cols-1 gap-2.5 text-left sm:mt-14 md:grid-cols-3 md:gap-6">
                    {f.steps.map((s, n) => (
                      // Mobile : numéro à gauche du texte, carte compacte ; desktop : carte détaillée
                      <li key={s.title} className="flex items-start gap-3 rounded-xl border border-gray-200 bg-white p-3.5 md:block md:rounded-2xl md:p-8">
                        <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-black text-xs font-semibold text-white md:h-10 md:w-10 md:text-sm">
                          {n + 1}
                        </span>
                        <div>
                          <h3 className="text-sm font-semibold md:mt-5 md:text-lg">{s.title}</h3>
                          <p className="mt-0.5 text-xs leading-relaxed text-gray-600 md:mt-2 md:text-sm">{s.text}</p>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            )}
          </section>
        );
      })}

      {/* COMMENT ÇA MARCHE */}
      <section className="py-12 sm:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="text-center">
            <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-gray-500 sm:text-xs">Comment ça marche</p>
            <h2 className="mt-2 text-xl font-light tracking-tight sm:mt-3 sm:text-4xl">
              Trois étapes, <span className="font-semibold">zéro friction</span>
            </h2>
          </div>
          {/* Mobile : numéro à gauche du texte ; desktop : trois colonnes centrées */}
          <ol className="mt-6 grid grid-cols-1 gap-4 sm:mt-12 md:grid-cols-3 md:gap-8 md:text-center">
            {STEPS.map((s, i) => (
              <li key={s.title} className="flex items-start gap-3 md:block">
                <span className="w-8 flex-shrink-0 text-2xl font-extralight leading-none text-gray-300 md:w-auto md:text-4xl">
                  0{i + 1}
                </span>
                <div>
                  <h3 className="text-sm font-semibold md:mt-3 md:text-base">{s.title}</h3>
                  <p className="mt-0.5 text-xs leading-relaxed text-gray-600 md:mt-2 md:text-sm">{s.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* AVANTAGES MEMBRES — mêmes règles que la plateforme : credit_wallet_topup
          (+5 € par tranche complète de 100 €) et VolumeDiscountBanner (-5 % / -10 %) */}
      <section className="bg-neutral-50 py-12 sm:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="text-center">
            <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-gray-500 sm:text-xs">Avantages membres</p>
            <h2 className="mt-2 text-xl font-light tracking-tight sm:mt-3 sm:text-4xl">
              Plus vous achetez, <span className="font-semibold">plus vous économisez</span>
            </h2>
          </div>
          {/* Mobile : deux petites cartes côte à côte ; desktop : cartes détaillées */}
          <div className="mt-6 grid grid-cols-2 gap-2.5 sm:mt-12 sm:gap-6">
            <div className="rounded-2xl border border-gray-200 bg-white p-3 shadow-sm sm:rounded-3xl sm:p-8">
              <div className="flex items-center gap-2 sm:block">
                <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-black text-white sm:h-12 sm:w-12 sm:rounded-2xl">
                  <Wallet className="h-3.5 w-3.5 sm:h-6 sm:w-6" />
                </div>
                <h3 className="text-xs font-semibold leading-tight tracking-tight sm:mt-6 sm:text-xl">Portefeuille rechargeable</h3>
              </div>
              <p className="mt-2 hidden text-sm leading-relaxed text-gray-600 sm:block">
                Rechargez votre solde par carte et payez vos commandes, enchères et livraisons en un clic.
              </p>
              <div className="mt-2.5 rounded-xl bg-neutral-50 p-2.5 text-center sm:mt-6 sm:flex sm:items-end sm:gap-3 sm:rounded-2xl sm:p-5 sm:text-left">
                <span className="block text-xl font-semibold tracking-tight sm:inline sm:text-4xl">+5 €</span>
                <span className="block text-[10px] leading-tight text-gray-600 sm:inline sm:pb-1 sm:text-sm">
                  offerts tous les 100 € rechargés
                </span>
              </div>
              <p className="mt-3 hidden text-xs text-gray-500 sm:block">Ex. : 300 € rechargés = 315 € crédités sur votre solde.</p>
            </div>

            <div className="rounded-2xl border border-gray-200 bg-white p-3 shadow-sm sm:rounded-3xl sm:p-8">
              <div className="flex items-center gap-2 sm:block">
                <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-black text-white sm:h-12 sm:w-12 sm:rounded-2xl">
                  <Percent className="h-3.5 w-3.5 sm:h-6 sm:w-6" />
                </div>
                <h3 className="text-xs font-semibold leading-tight tracking-tight sm:mt-6 sm:text-xl">Remises de volume</h3>
              </div>
              <p className="mt-2 hidden text-sm leading-relaxed text-gray-600 sm:block">
                Appliquées automatiquement sur votre commande, selon le nombre d'articles.
              </p>
              <div className="mt-2.5 grid grid-cols-2 gap-1.5 sm:mt-6 sm:gap-3">
                {[
                  { count: '5 art.', countLong: '5 articles', off: '-5 %' },
                  { count: '10 art.', countLong: '10 articles', off: '-10 %' },
                ].map((t) => (
                  <div key={t.count} className="rounded-xl bg-neutral-50 p-2 text-center sm:rounded-2xl sm:p-5">
                    <p className="text-base font-semibold tracking-tight sm:text-4xl">{t.off}</p>
                    <p className="text-[10px] text-gray-600 sm:mt-1 sm:text-sm">
                      dès <span className="sm:hidden">{t.count}</span><span className="hidden sm:inline">{t.countLong}</span>
                    </p>
                  </div>
                ))}
              </div>
              <p className="mt-3 hidden text-xs text-gray-500 sm:block">Cumulables avec le bonus du portefeuille.</p>
            </div>
          </div>
        </div>
      </section>

      {/* TARIFS */}
      <section id="tarifs" className="relative scroll-mt-20 overflow-hidden py-20 sm:py-24">
        <img src={clubImg} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover object-[50%_30%]" />
        <div className="absolute inset-0 bg-black/65" />
        <div className="relative mx-auto max-w-6xl px-4 sm:px-6">
          <div className="text-center">
            <p className="text-xs font-medium uppercase tracking-[0.25em] text-white/60">Adhésion</p>
            <h2 className="mt-3 text-2xl font-light tracking-tight text-white sm:text-4xl">
              Le <span className="font-semibold">Club B2B</span> OZË Paris
            </h2>
          </div>
          <p className="mx-auto mt-4 max-w-xl text-center text-sm text-white/70 sm:text-base">
            Trois formules selon votre activité : drops, accès complet, ou accompagnement dédié pour les boutiques.
          </p>
          <div className="mx-auto mt-10 grid max-w-6xl grid-cols-1 items-stretch gap-5 sm:mt-16 sm:gap-6 lg:grid-cols-3 lg:items-center">
            {PLANS.map((p) => <PlanCard key={p.id} plan={p} />)}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="scroll-mt-20 py-12 sm:py-24">
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          <div className="text-center">
            <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-gray-500 sm:text-xs">Questions fréquentes</p>
            <h2 className="mt-2 text-xl font-light tracking-tight sm:mt-3 sm:text-4xl">
              Achetez <span className="font-semibold">en confiance</span>
            </h2>
          </div>
          <div className="mt-6 border-t border-gray-200 sm:mt-10">
            {FAQ.map((f) => <FaqItem key={f.q} q={f.q} short={f.short} a={f.a} />)}
          </div>
        </div>
      </section>

      {/* FOOTER — compact : appel à l'action, une ligne de liens, mentions légales */}
      <footer className="bg-neutral-950 text-white">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          {/* Appel à l'action */}
          <div className="flex flex-col items-center gap-4 border-b border-white/10 py-8 text-center md:flex-row md:justify-between md:text-left">
            <div>
              <h2 className="text-lg font-light tracking-tight sm:text-2xl">
                Prêt à rejoindre le <span className="font-semibold">Club B2B</span> ?
              </h2>
              <p className="mt-1 text-xs text-white/60 sm:text-sm">Sans engagement, accès ouvert dès le paiement.</p>
            </div>
            <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:gap-3">
              <button
                onClick={() => scrollTo('tarifs')}
                className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-white px-4 py-2.5 text-xs font-semibold text-black transition-colors hover:bg-gray-100 sm:px-6 sm:py-3 sm:text-sm"
              >
                Voir les offres <ArrowRight className="h-4 w-4" />
              </button>
              <a
                href={AGENT_URL}
                target={WHATSAPP_NUMBER ? '_blank' : undefined}
                rel={WHATSAPP_NUMBER ? 'noopener noreferrer' : undefined}
                className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#25D366] px-4 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-[#1EBE5A] sm:px-6 sm:py-3 sm:text-sm"
              >
                <WhatsAppIcon className="h-4 w-4" /> Parler à un agent
              </a>
            </div>
          </div>

          {/* Logo + liens */}
          <div className="flex flex-col gap-5 py-6 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center justify-between gap-4 md:justify-start">
              <img src={logoWhite} alt="OZË Paris — B2B Solutions" className="h-10 w-auto" />
              <div className="flex items-center gap-2">
                {DISCORD_URL && (
                  <a
                    href={DISCORD_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Discord"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/10 transition-colors hover:bg-[#5865F2]"
                  >
                    <DiscordIcon className="h-4 w-4" />
                  </a>
                )}
                <a
                  href={`mailto:${SUPPORT_EMAIL}`}
                  aria-label="Email"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/10 transition-colors hover:bg-white/20"
                >
                  <Mail className="h-4 w-4" />
                </a>
              </div>
            </div>
            <nav className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-white/60 sm:text-sm">
              {[...NAV.filter((n) => n.id !== 'faq'), { id: 'tarifs', label: 'Tarifs' }, { id: 'faq', label: 'FAQ' }].map((n) => (
                <button key={n.id} onClick={() => scrollTo(n.id)} className="transition-colors hover:text-white">
                  {n.label}
                </button>
              ))}
              <a href="/cgv" className="transition-colors hover:text-white">CGV</a>
              <button onClick={goToLogin} className="transition-colors hover:text-white">Espace revendeur</button>
            </nav>
          </div>

          {/* Mentions légales */}
          <div className="flex flex-col gap-1 border-t border-white/10 py-4 text-[11px] text-white/40 md:flex-row md:justify-between">
            <p>© {new Date().getFullYear()} OZË Paris · {SUPPORT_EMAIL}</p>
            <p>
              {COMPANY_LEGAL_NAME} · SIRET {COMPANY_SIRET} · {COMPANY_RCS} · TVA {COMPANY_VAT_NUMBER} · {COMPANY_ADDRESS}
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default B2BLanding;
