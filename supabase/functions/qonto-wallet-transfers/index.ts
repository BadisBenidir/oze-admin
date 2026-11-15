// Edge Function : qonto-wallet-transfers
//
// Synchro LÉGÈRE des virements entrants récents (3 derniers jours) pour
// créditer les rechargements de portefeuille quasi instantanément (0292) :
// appelée chaque minute par pg_cron (0293) et par le bouton « J'ai fait mon
// virement » de la page Portefeuille. Ne fait que :
//   1. lire les virements entrants reçus sur Qonto ;
//   2. les enregistrer dans bank_transactions (même format que qonto-sync) ;
//   3. créditer ceux dont le libellé contient une référence OZE-R-… connue
//      (wallet_match_transfers : idempotent, un virement = un seul crédit).
// La synchro complète (solde, charges, factures…) reste qonto-sync.
//
// Déploiement : `supabase functions deploy qonto-wallet-transfers --no-verify-jwt`
// Secrets : QONTO_SECRET_KEY, QONTO_ORGANIZATION_SLUG (QONTO_IBAN facultatif)

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const QONTO_BASE_URL = 'https://thirdparty.qonto.com/v2';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const secretKey = Deno.env.get('QONTO_SECRET_KEY');
    const orgSlug = Deno.env.get('QONTO_ORGANIZATION_SLUG');
    if (!secretKey || !orgSlug) return json({ error: 'Identifiants Qonto manquants' }, 500);
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const { data: settings } = await admin.from('wallet_settings').select('iban').maybeSingle();
    const iban = Deno.env.get('QONTO_IBAN') || settings?.iban;
    if (!iban) return json({ error: 'IBAN inconnu : lancer une synchro Qonto complète' }, 500);

    const url = new URL(`${QONTO_BASE_URL}/transactions`);
    url.searchParams.set('iban', iban);
    url.searchParams.set('side', 'credit');
    url.searchParams.append('status[]', 'completed');
    url.searchParams.set('settled_at_from', new Date(Date.now() - 3 * 86400000).toISOString());
    url.searchParams.set('sort_by', 'settled_at:desc');
    url.searchParams.set('per_page', '100');
    const res = await fetch(url.toString(), { headers: { Authorization: `${orgSlug}:${secretKey}` } });
    if (!res.ok) return json({ error: `Qonto /transactions (${res.status})` }, 502);
    const transactions = ((await res.json())?.transactions || []) as Record<string, unknown>[];

    for (const tx of transactions) {
      await admin.from('bank_transactions').upsert(
        {
          qonto_transaction_id: tx.transaction_id,
          qonto_status: tx.status,
          side: tx.side,
          operation_type: tx.operation_type,
          amount: tx.amount,
          currency: (tx.currency as string) || 'EUR',
          label: tx.label,
          emitted_at: tx.emitted_at,
          settled_at: tx.settled_at,
          attachment_ids: (tx.attachment_ids as string[]) || [],
          raw: tx,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'qonto_transaction_id', ignoreDuplicates: false }
      );
    }

    const { data: matched, error } = await admin.rpc('wallet_match_transfers');
    if (error) return json({ error: error.message }, 500);
    return json({ success: true, checked: transactions.length, ...(matched as Record<string, unknown>) });
  } catch (e) {
    console.error('qonto-wallet-transfers', e);
    return json({ error: e instanceof Error ? e.message : 'Erreur' }, 500);
  }
});
