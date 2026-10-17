// Edge Function : qonto-mark-invoices-paid
//
// Les factures de COMMANDE émises sur Qonto (emit-qonto-invoice) concernent
// des commandes déjà réglées (carte Stripe ou solde), mais Qonto les crée
// « À encaisser » (POST /v2/client_invoices n'accepte que draft/unpaid) :
// elles apparaissaient toutes « En retard ». Cette fonction les passe en
// « Payée » via POST /v2/client_invoices/{id}/mark_as_paid, avec la date de
// paiement réelle de la commande (orders.paid_at, 0165, sinon created_at).
//
// Jamais les factures d'avance de sourcing (kind 'advance', 0196) : elles
// attendent un vrai virement et sont suivies par qonto-sync.
//
// Réservé aux admins. Corps : {} (toutes) ou { order_ids: [...] }.
// Déploiement : `supabase functions deploy qonto-mark-invoices-paid`

import { createClient } from 'npm:@supabase/supabase-js@2';
import { hasAdminAccess } from '../_shared/adminAccess.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const QONTO_BASE_URL = 'https://thirdparty.qonto.com/v2';

/** Date YYYY-MM-DD (heure de Paris), jamais dans le futur (refusé par Qonto). */
export const qontoPaidDate = (iso: string | null | undefined): string => {
  const at = iso ? new Date(iso) : new Date();
  const capped = at.getTime() > Date.now() ? new Date() : at;
  return capped.toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' });
};

interface Row {
  id: string;
  qonto_invoice_id: string;
  order: { payment_status: string | null; status: string | null; paid_at: string | null; created_at: string; order_number: string } | null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Non authentifié' }, 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const callerClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await callerClient.auth.getUser();
    if (!user) return json({ error: 'Non authentifié' }, 401);
    const { data: callerProfile } = await callerClient.from('profiles').select('role').eq('id', user.id).maybeSingle();
    if (!(await hasAdminAccess(callerClient, user.id, 'invoicing'))) return json({ error: 'Accès refusé : réservé aux administrateurs' }, 403);

    const secretKey = Deno.env.get('QONTO_SECRET_KEY');
    const orgSlug = Deno.env.get('QONTO_ORGANIZATION_SLUG');
    if (!secretKey || !orgSlug) return json({ error: 'QONTO_SECRET_KEY / QONTO_ORGANIZATION_SLUG manquants dans les secrets Supabase' }, 500);
    const qontoHeaders = { Authorization: `${orgSlug}:${secretKey}`, 'Content-Type': 'application/json' };

    const { order_ids } = await req.json().catch(() => ({}));
    const adminClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    let query = adminClient
      .from('invoices')
      .select('id, qonto_invoice_id, order:orders(payment_status, status, paid_at, created_at, order_number)')
      .eq('kind', 'order')
      .not('qonto_invoice_id', 'is', null)
      .not('transmission_status', 'in', '(paid,cancelled,canceled)');
    if (Array.isArray(order_ids) && order_ids.length) query = query.in('order_id', order_ids);
    const { data, error } = await query;
    if (error) return json({ error: error.message }, 500);

    const rows = ((data || []) as unknown as Row[]).filter(
      (r) => r.order && ['paid', 'succeeded'].includes(r.order.payment_status || '') && !['cancelled', 'canceled'].includes(r.order.status || '')
    );

    let marked = 0;
    const failures: string[] = [];
    // Séquentiel : pas de rafale d'appels simultanés sur l'API Qonto.
    for (const row of rows) {
      const res = await fetch(`${QONTO_BASE_URL}/client_invoices/${row.qonto_invoice_id}/mark_as_paid`, {
        method: 'POST',
        headers: qontoHeaders,
        body: JSON.stringify({ paid_at: qontoPaidDate(row.order!.paid_at || row.order!.created_at) }),
      });
      if (!res.ok) {
        const body = await res.text();
        console.error('qonto-mark-invoices-paid:', row.order!.order_number, res.status, body);
        failures.push(`${row.order!.order_number} : Qonto ${res.status} ${body.slice(0, 200)}`);
        continue;
      }
      await adminClient.from('invoices').update({ transmission_status: 'paid' }).eq('id', row.id);
      marked += 1;
    }

    return json({ success: true, checked: rows.length, marked, failures });
  } catch (err) {
    console.error('qonto-mark-invoices-paid: erreur non gérée', err instanceof Error ? err.stack || err.message : err);
    return json({ error: err instanceof Error ? err.message : 'Erreur inconnue' }, 500);
  }
});
