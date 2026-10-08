// Edge Function : subscription-promo-codes
//
// Liste les codes promo Stripe (Dashboard Stripe → Coupons → Codes
// promotionnels) pour l'écran admin « Codes promo Club » : conditions de la
// remise, utilisations comptées par Stripe, limite et expiration. Les membres
// et le CA par code sont lus côté admin dans b2b_subscription_payments (0191).
// Réservée aux admins.
//
// Secrets : STRIPE_SECRET_KEY
// Déploiement : `supabase functions deploy subscription-promo-codes`

import { createClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@17.7.0?target=deno';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return reply({ error: 'Non authentifié' }, 401);
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY');
    if (!stripeSecretKey) return reply({ error: 'Configuration serveur manquante' }, 500);

    const caller = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await caller.auth.getUser();
    if (!user) return reply({ error: 'Non authentifié' }, 401);

    const admin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: me } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle();
    if (me?.role !== 'admin') return reply({ error: 'Accès refusé' }, 403);

    const stripe = new Stripe(stripeSecretKey, { apiVersion: '2024-06-20' });
    const codes = [];
    for await (const promo of stripe.promotionCodes.list({ limit: 100, expand: ['data.coupon'] })) {
      const coupon = promo.coupon;
      codes.push({
        id: promo.id,
        code: promo.code,
        active: promo.active && coupon.valid,
        times_redeemed: promo.times_redeemed,
        max_redemptions: promo.max_redemptions,
        expires_at: promo.expires_at ? new Date(promo.expires_at * 1000).toISOString() : null,
        created_at: new Date(promo.created * 1000).toISOString(),
        coupon: {
          name: coupon.name,
          percent_off: coupon.percent_off,
          amount_off: coupon.amount_off != null ? coupon.amount_off / 100 : null,
          duration: coupon.duration,
          duration_in_months: coupon.duration_in_months,
        },
      });
      if (codes.length >= 500) break;
    }
    return reply({ codes });
  } catch (err) {
    return reply({ error: err instanceof Error ? err.message : 'Erreur inconnue' }, 500);
  }
});
