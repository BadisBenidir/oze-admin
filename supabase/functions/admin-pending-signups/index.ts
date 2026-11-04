// Edge Function : admin-pending-signups
//
// Inscriptions Club B2B commencées mais jamais payées (b2b_pending_signups,
// status 'pending') — actions de l'admin depuis la section Abonnés :
//   - action "remind" (+ signup_ids) : renvoie l'email de relance (même email
//     que la relance automatique, lien de reprise du paiement valable 30 jours
//     après l'inscription) et note la date de la relance (0241) ;
//   - action "delete" (+ signup_ids) : supprime l'inscription (test, doublon…).
// Réservé à l'équipe avec le droit « accounts ».
//
// Déploiement : `supabase functions deploy admin-pending-signups`

import { createClient } from 'npm:@supabase/supabase-js@2';
import { hasAdminAccess } from '../_shared/adminAccess.ts';
import { sendAbandonedSignupEmail } from '../b2b-stripe-webhook/subscriptionEmails.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const PLAN_LABEL: Record<string, string> = { drops: 'Pass Drops', revendeur: 'Pass Revendeur' };
const RESUME_URL = 'https://b2b.ozeparis.com/inscription/reprendre';
const RESUME_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Non authentifié' }, 401);
    const callerClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await callerClient.auth.getUser();
    if (!user) return json({ error: 'Non authentifié' }, 401);
    if (!(await hasAdminAccess(callerClient, user.id, 'accounts'))) return json({ error: 'Action réservée aux administrateurs' }, 403);

    const { action, signup_ids } = await req.json();
    const ids = Array.isArray(signup_ids) ? signup_ids.filter((id: unknown) => typeof id === 'string').slice(0, 100) : [];
    if (!['remind', 'delete'].includes(action) || ids.length === 0) return json({ error: 'Requête invalide' }, 400);

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data: signups } = await admin
      .from('b2b_pending_signups')
      .select('id, email, first_name, plan, status, created_at, reminder_count')
      .in('id', ids)
      .eq('status', 'pending');
    const rows = signups || [];

    if (action === 'delete') {
      if (rows.length) await admin.from('b2b_pending_signups').delete().in('id', rows.map((r) => r.id)).eq('status', 'pending');
      return json({ success: true, deleted: rows.length });
    }

    let sent = 0;
    const expired: string[] = [];
    for (const s of rows) {
      if (Date.now() - new Date(s.created_at).getTime() > RESUME_MAX_AGE_MS) {
        expired.push(s.email);
        continue;
      }
      await sendAbandonedSignupEmail(s.email, s.first_name ?? null, PLAN_LABEL[s.plan] || 'Club B2B', `${RESUME_URL}?id=${s.id}`);
      await admin
        .from('b2b_pending_signups')
        .update({ last_reminded_at: new Date().toISOString(), reminder_count: (s.reminder_count || 0) + 1 })
        .eq('id', s.id);
      sent += 1;
    }
    return json({ success: true, sent, expired });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Erreur inconnue' }, 500);
  }
});
