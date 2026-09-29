/**
 * Offres du Club B2B et réglages Vercel associés, partagés entre la landing
 * (B2BLanding) et la page d'inscription (B2BSignup).
 *
 * Abonnement : chaque pass passe par /inscription, puis par une session
 * Stripe Checkout ouverte côté serveur (Edge Function b2b-signup, prix Stripe
 * STRIPE_PRICE_DROPS / STRIPE_PRICE_REVENDEUR côté Supabase) — voir 0167.
 * Les prix affichés ici doivent correspondre à ceux configurés dans Stripe.
 *   VITE_B2B_PASS_DROPS_PRICE             remplace le prix par défaut (39,90 €)
 *   VITE_B2B_SUBSCRIPTION_PRICE           remplace le prix par défaut (69,90 €)
 *   VITE_B2B_SUBSCRIPTION_PERIOD          remplace "/ mois" (commun aux deux pass)
 *   VITE_B2B_WHATSAPP_NUMBER              numéro international sans + ni espaces, ex. 33612345678
 *                                         (Pass Boutiques ; sinon repli sur l'email)
 *   VITE_B2B_DISCORD_URL                  remplace l'invitation Discord par défaut
 */
const env = (key: string) => ((import.meta.env[key] as string | undefined) ?? '').trim();

export const PERIOD = env('VITE_B2B_SUBSCRIPTION_PERIOD') || '/ mois';
export const DISCORD_URL = env('VITE_B2B_DISCORD_URL') || 'https://discord.gg/qVX3ueywBu';
export const WHATSAPP_NUMBER = env('VITE_B2B_WHATSAPP_NUMBER').replace(/\D/g, '');
export const SUPPORT_EMAIL = 'contact@ozeparis.com';
export const accessRequestUrl = (pass: string) =>
  `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`Demande d'accès — ${pass} OZË Paris`)}`;
export const AGENT_URL = WHATSAPP_NUMBER
  ? `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent('Bonjour, je souhaite en savoir plus sur le Pass Boutiques OZË Paris.')}`
  : accessRequestUrl('Pass Boutiques');

/** Pass souscrivables en ligne (valeurs de b2b_signup_requests.plan). */
export type SignupPlanId = 'drops' | 'revendeur';

export type Plan = {
  id: SignupPlanId | 'boutiques';
  name: string;
  pitch: string;
  price: string;
  featured?: boolean;
  badge?: string;
  intro?: string;
  features: { label: string; included: boolean }[];
  agent?: boolean; // bouton « Contacter un agent » (WhatsApp) au lieu de l'inscription
};

export const PLANS: Plan[] = [
  {
    id: 'drops',
    name: 'Pass Drops',
    pitch: 'Pour acheter sur le catalogue et les drops, à l\'unité.',
    price: env('VITE_B2B_PASS_DROPS_PRICE') || '39,90 €',
    features: [
      { label: 'Drops & catalogue B2B, achat à l\'unité', included: true },
      { label: 'Certificats Entrupy disponibles', included: true },
      { label: 'Expédition groupée quand vous voulez', included: true },
      { label: 'Sessions d\'enchères privées', included: false },
      { label: 'Sourcing sur mesure', included: false },
    ],
  },
  {
    id: 'revendeur',
    name: 'Pass Revendeur',
    pitch: 'L\'accès complet à la plateforme pour les revendeurs.',
    price: env('VITE_B2B_SUBSCRIPTION_PRICE') || '69,90 €',
    featured: true,
    badge: 'Accès complet',
    features: [
      { label: 'Drops & catalogue B2B, achat à l\'unité', included: true },
      { label: 'Sessions d\'enchères privées, lots dès 0 €', included: true },
      { label: 'Sourcing sur mesure', included: true },
      { label: 'Certificats Entrupy disponibles', included: true },
      { label: 'Expédition groupée quand vous voulez', included: true },
    ],
  },
  {
    id: 'boutiques',
    name: 'Pass Boutiques',
    pitch: 'Pour les boutiques et gros volumes, avec une équipe à vos côtés.',
    price: '',
    agent: true,
    intro: 'Tout le Pass Revendeur, plus :',
    features: [
      { label: 'Une équipe dédiée à votre boutique', included: true },
      { label: 'Un agent joignable en direct sur WhatsApp', included: true },
      { label: 'Sourcing en volume pour vos réassorts', included: true },
      { label: 'Conditions tarifaires sur mesure', included: true },
      { label: 'Plusieurs comptes pour votre équipe', included: true },
    ],
  },
];

export const signupUrl = (plan: SignupPlanId) => `/inscription?pass=${plan}`;
