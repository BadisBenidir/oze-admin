// Edge Function : cancel-entrupy-certificate
//
// Retire le certificat Entrupy d'UN article de commande B2B — sans annuler
// l'article lui-même (contrairement à cancel-b2b-order-item) — et rembourse
// 19,99 € directement en crédit portefeuille B2B : toujours en solde, jamais
// de choix Stripe ici, sur demande explicite. Réservé aux admins OZË.
//
// Déploiement : `supabase functions deploy cancel-entrupy-certificate`

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Non authentifié' }, 401);

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await callerClient.auth.getUser();
    if (userError || !user) return json({ error: 'Non authentifié' }, 401);

    const { data: callerProfile } = await callerClient
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();
    if (callerProfile?.role !== 'admin') {
      return json({ error: 'Action réservée aux administrateurs' }, 403);
    }

    const { order_item_id } = await req.json();
    if (!order_item_id) return json({ error: 'order_item_id est requis' }, 400);

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: result, error: rpcError } = await adminClient.rpc('admin_cancel_entrupy_certificate', {
      p_order_item_id: order_item_id,
    });
    if (rpcError) return json({ error: rpcError.message }, 400);

    // Un échec du remboursement n'annule pas le retrait du certificat déjà
    // acté en base — il est simplement signalé (même logique que
    // cancel-b2b-order-item).
    let refundStatus: 'not_applicable' | 'succeeded' | 'failed' = 'not_applicable';
    let refundError: string | undefined;

    if (result?.payment_status === 'paid' && Number(result?.refund_amount) > 0) {
      const { error: walletError } = await adminClient.rpc('credit_order_item_refund_to_wallet', {
        p_profile_id: result.placed_by_profile_id,
        p_reseller_id: result.reseller_id,
        p_amount: Number(result.refund_amount),
        p_order_id: result.order_id,
        p_note: `Remboursement (certificat Entrupy annulé) — commande ${result.order_id}`,
      });
      if (walletError) {
        refundStatus = 'failed';
        refundError = walletError.message;
      } else {
        refundStatus = 'succeeded';
      }
    }

    return json({
      success: true,
      order_id: result?.order_id,
      refund_amount: result?.refund_amount,
      refund_status: refundStatus,
      refund_error: refundError,
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Erreur inconnue' }, 500);
  }
});
