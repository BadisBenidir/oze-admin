// Edge Function : sync-sendcloud-costs
//
// Relit les factures Sendcloud (API v2 /user/invoices) et les enregistre dans
// sendcloud_invoices (0239) : frais d'expédition déduits de la marge dans
// Comptabilité & Finances. Idempotente (clé : id de facture Sendcloud),
// lecture seule côté Sendcloud. Appelée chaque nuit par pg_cron et par le
// bouton « Synchroniser Sendcloud » de la comptabilité.
//
// Secrets : SENDCLOUD_PUBLIC_KEY, SENDCLOUD_SECRET_KEY
// Déploiement : `supabase functions deploy sync-sendcloud-costs --no-verify-jwt`

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

type SendcloudInvoice = Record<string, unknown>;

const num = (v: unknown) => {
  const n = Number(typeof v === 'string' ? v.replace(',', '.') : v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const publicKey = Deno.env.get('SENDCLOUD_PUBLIC_KEY');
  const secretKey = Deno.env.get('SENDCLOUD_SECRET_KEY');
  if (!publicKey || !secretKey) return json({ error: 'Clés Sendcloud manquantes' }, 500);
  const auth = 'Basic ' + btoa(`${publicKey}:${secretKey}`);

  try {
    const invoices: SendcloudInvoice[] = [];
    let url: string | null = 'https://panel.sendcloud.sc/api/v2/user/invoices';
    for (let page = 0; url && page < 50; page++) {
      const res: Response = await fetch(url, { headers: { Authorization: auth, Accept: 'application/json' } });
      const body = await res.json().catch(() => null) as { invoices?: SendcloudInvoice[]; next?: string | null } | SendcloudInvoice[] | null;
      if (!res.ok) return json({ error: `Sendcloud ${res.status}`, body }, 502);
      const list = Array.isArray(body) ? body : body?.invoices || [];
      invoices.push(...list);
      url = !Array.isArray(body) && body?.next ? body.next : null;
    }

    const rows = invoices
      .map((inv) => {
        const date = String(inv.date ?? inv.invoice_date ?? inv.created_at ?? '').slice(0, 10);
        return {
          id: String(inv.id ?? inv.ref ?? ''),
          ref: inv.ref != null ? String(inv.ref) : null,
          invoice_date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : /^\d{2}-\d{2}-\d{4}$/.test(date) ? date.split('-').reverse().join('-') : null,
          price_excl: num(inv.price_excl ?? inv.price_excl_vat ?? inv.total_excl ?? inv.price),
          price_incl: num(inv.price_incl ?? inv.price_incl_vat ?? inv.total_incl ?? inv.price),
          type: inv.type != null ? String(inv.type) : null,
          is_paid: typeof inv.isPayed === 'boolean' ? inv.isPayed : typeof inv.is_paid === 'boolean' ? inv.is_paid : null,
          raw: inv,
          synced_at: new Date().toISOString(),
        };
      })
      .filter((r) => r.id && r.invoice_date);

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    if (rows.length) {
      const { error } = await admin.from('sendcloud_invoices').upsert(rows, { onConflict: 'id' });
      if (error) return json({ error: error.message }, 500);
    }
    return json({
      fetched: invoices.length,
      saved: rows.length,
      skipped: invoices.length - rows.length,
      total_excl: Math.round(rows.reduce((s, r) => s + r.price_excl, 0) * 100) / 100,
      sample_keys: invoices[0] ? Object.keys(invoices[0]) : [],
    });
  } catch (err) {
    console.error('[sync-sendcloud-costs]', err);
    return json({ error: err instanceof Error ? err.message : 'Erreur inattendue' }, 500);
  }
});
