// Edge Function : instagram-order — page publique d'une vente Instagram.
//
// Seul point d'entrée de la page client (pro.ozeparis.com/commande/<jeton>),
// sans compte. Clé service role ; ne renvoie que la commande du jeton
// (RPC instagram_order_public_*, migrations 0300-0302).
//
// POST { action, token, ... } :
//   get      → état de la commande (+ rafraîchit le suivi colis si besoin)
//   save     → { email, shipping, entrupy_product_ids } : livraison + certificats
//   declare  → « J'ai fait le virement » : annonce SEULEMENT, puis synchro
//              Qonto immédiate (qonto-wallet-transfers) ; le paiement n'est
//              validé que si un virement correspondant est trouvé.
//   invoice  → PDF de la facture (commande payée uniquement)
//   cron     → (sans jeton, cron 5 min) e-mails de facture en attente +
//              suivi des colis. Idempotent.
//
// Déploiement : supabase functions deploy instagram-order --no-verify-jwt
//
// @ts-nocheck — runtime Deno Supabase.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { classifySendcloudStatus } from '../_shared/sendcloudStatus.ts';
import { buildInvoicePdf } from './invoicePdf.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const PRO_SITE_URL = Deno.env.get('PRO_SITE_URL') || 'https://pro.ozeparis.com';
const admin = createClient(SUPABASE_URL, SERVICE_KEY);

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const eur = (n: unknown) => (Number(n) || 0).toFixed(2).replace('.', ',') + ' €';

async function getLinkByToken(token: string) {
  if (!token || token.length < 20) return null;
  const { data } = await admin.from('instagram_order_links').select('*').eq('token', token).maybeSingle();
  return data;
}

// ---------------------------------------------------------------------------
// Facture PDF (lignes articles + une ligne par certificat Entrupy).
async function invoicePdf(orderId: string, link: any): Promise<{ bytes: Uint8Array; order: any } | null> {
  const { data: order } = await admin
    .from('orders')
    .select('id, order_number, email, created_at, paid_at, subtotal, shipping_cost, total_amount, shipping_address, payment_status, status, payment_method_effective')
    .eq('id', orderId)
    .single();
  if (!order || !link.paid_at) return null;
  let { data: num } = await admin.rpc('assign_web_invoice', { p_order_id: orderId });
  if (!num) {
    const { data: inv } = await admin.from('invoices').select('invoice_number').eq('order_id', orderId).eq('kind', 'order')
      .order('issued_at', { ascending: false }).limit(1).maybeSingle();
    num = inv?.invoice_number;
  }
  order.invoice_number = num;
  const { data: rawItems } = await admin
    .from('order_items')
    .select('product_id, quantity, unit_price, line_total, product_snapshot, entrupy_requested, entrupy_cost')
    .eq('order_id', orderId)
    .eq('status', 'active');
  const items: any[] = [];
  for (const it of rawItems || []) {
    items.push(it);
    if (it.entrupy_requested) {
      const price = Number(it.entrupy_cost) || 25;
      items.push({
        quantity: 1, unit_price: price, line_total: price,
        product_snapshot: { name: `Certificat d'authenticité Entrupy — ${it.product_snapshot?.name || 'article'}` },
      });
    }
  }
  // Date de facture = date du paiement ; TVA au taux de cette date.
  const at = order.paid_at || link.paid_at;
  const [{ data: rate }, { data: settings }] = await Promise.all([
    admin.rpc('vat_rate_at', { p_at: at }),
    admin.from('vat_settings').select('vat_number').maybeSingle(),
  ]);
  const bytes = await buildInvoicePdf({ ...order, created_at: at }, items, { rate: Number(rate) || 0, number: settings?.vat_number || null });
  return { bytes, order };
}

function toBase64(bytes: Uint8Array) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// E-mail « paiement reçu » + facture jointe. Une seule fois par commande.
async function sendInvoiceEmail(link: any) {
  if (link.invoice_emailed_at || !link.paid_at) return;
  const apiKey = Deno.env.get('RESEND_API_KEY');
  await admin.from('instagram_order_links').update({ email_attempts: (link.email_attempts || 0) + 1 }).eq('id', link.id);
  if (!apiKey) throw new Error('RESEND_API_KEY manquant');
  const res = await invoicePdf(link.order_id, link);
  if (!res || !res.order.email) return;
  const { order, bytes } = res;
  const sa = order.shipping_address || {};
  const url = `${PRO_SITE_URL}/commande/${link.token}`;
  const html = `
  <div style="font-family:Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#111">
    <p style="font-size:22px;letter-spacing:4px;font-weight:600;margin:24px 0">OZË PARIS</p>
    <p>Bonjour ${esc(sa.first_name || '')},</p>
    <p>Nous avons bien reçu votre virement de <strong>${eur(order.total_amount)}</strong> pour la commande <strong>${esc(order.order_number)}</strong>. Merci pour votre confiance !</p>
    <p>Votre facture <strong>${esc(order.invoice_number || '')}</strong> est jointe à cet e-mail.</p>
    <p>Votre pièce est en cours de préparation. Le délai de livraison est de 1 à 3 semaines : elle peut encore être au Japon ou en transit vers la France. Vous recevrez le numéro de suivi dès l'expédition.</p>
    <p style="margin:28px 0"><a href="${url}" style="background:#111;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none">Suivre ma commande</a></p>
    <p style="color:#666;font-size:13px">OZË Paris — 6 rue d'Armaillé, 75017 Paris — contact@ozeparis.com</p>
  </div>`;
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'OZE PARIS <nepasrepondre@ozeparis.com>',
      to: [order.email],
      reply_to: 'contact@ozeparis.com',
      subject: `Paiement reçu — commande ${order.order_number}`,
      html,
      attachments: [{ filename: `Facture-${order.invoice_number || order.order_number}.pdf`, content: toBase64(bytes) }],
    }),
  });
  if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text()}`);
  await admin.from('instagram_order_links').update({ invoice_emailed_at: new Date().toISOString() }).eq('id', link.id);
}

// Suivi colis : statut Sendcloud → orders.status shipped / delivered.
async function refreshTracking(link: any) {
  const { data: order } = await admin.from('orders').select('id, status, tracking_number').eq('id', link.order_id).single();
  if (!order?.tracking_number || ['delivered', 'cancelled'].includes(order.status)) return;
  await admin.from('instagram_order_links').update({ tracking_checked_at: new Date().toISOString() }).eq('id', link.id);
  const pub = Deno.env.get('SENDCLOUD_PUBLIC_KEY');
  const sec = Deno.env.get('SENDCLOUD_SECRET_KEY');
  if (!pub || !sec) return;
  const r = await fetch(`https://panel.sendcloud.sc/api/v2/parcels?tracking_number=${encodeURIComponent(order.tracking_number)}`, {
    headers: { Authorization: 'Basic ' + btoa(`${pub}:${sec}`) },
  });
  if (!r.ok) return;
  const parcel = (await r.json())?.parcels?.[0];
  const stage = classifySendcloudStatus(parcel?.status?.id, parcel?.status?.message);
  if (stage === 'delivered' || (stage === 'shipped' && order.status !== 'shipped')) {
    await admin.from('orders').update({ status: stage }).eq('id', order.id);
  }
}

async function publicState(token: string) {
  const { data, error } = await admin.rpc('instagram_order_public_get', { p_token: token });
  if (error) throw new Error(error.message);
  return data;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Méthode non autorisée' }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || 'get');

    if (action === 'cron') {
      const { data: links } = await admin
        .from('instagram_order_links')
        .select('*, order:orders!inner(status, tracking_number)')
        .not('paid_at', 'is', null)
        .order('paid_at', { ascending: false })
        .limit(200);
      let emails = 0, tracked = 0;
      const stale = Date.now() - 2 * 3600 * 1000;
      for (const l of links || []) {
        if (!l.invoice_emailed_at && l.email_attempts < 5) {
          try { await sendInvoiceEmail(l); emails++; } catch (e) { console.error('[instagram-order] email', l.id, (e as Error).message); }
        }
        if (l.order?.tracking_number && !['delivered', 'cancelled'].includes(l.order.status)
            && (!l.tracking_checked_at || new Date(l.tracking_checked_at).getTime() < stale)) {
          try { await refreshTracking(l); tracked++; } catch (e) { console.error('[instagram-order] tracking', l.id, (e as Error).message); }
        }
      }
      return json({ ok: true, emails, tracked });
    }

    const token = String(body.token || '');
    const link = await getLinkByToken(token);
    if (!link) return json({ status: 'invalid' });

    if (action === 'get') {
      if (link.paid_at && (!link.tracking_checked_at || Date.now() - new Date(link.tracking_checked_at).getTime() > 30 * 60 * 1000)) {
        try { await refreshTracking(link); } catch (_) { /* suivi best effort */ }
      }
      return json(await publicState(token));
    }

    if (action === 'save') {
      const { error } = await admin.rpc('instagram_order_public_save', {
        p_token: token,
        p_email: String(body.email || ''),
        p_shipping: body.shipping && typeof body.shipping === 'object' ? body.shipping : {},
        p_entrupy_product_ids: Array.isArray(body.entrupy_product_ids) ? body.entrupy_product_ids.filter((x: unknown) => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x as string)) : [],
      });
      if (error) return json({ error: error.message }, 400);
      return json(await publicState(token));
    }

    if (action === 'declare') {
      const { error } = await admin.rpc('instagram_order_public_declare', { p_token: token });
      if (error) return json({ error: error.message }, 400);
      // Synchro Qonto immédiate (crédits des 3 derniers jours + rapprochements).
      try {
        await fetch(`${SUPABASE_URL}/functions/v1/qonto-wallet-transfers`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}` },
          body: '{}',
        });
      } catch (e) { console.error('[instagram-order] sync qonto', (e as Error).message); }
      const fresh = await getLinkByToken(token);
      if (fresh?.paid_at && !fresh.invoice_emailed_at) {
        try { await sendInvoiceEmail(fresh); } catch (e) { console.error('[instagram-order] email', (e as Error).message); }
      }
      return json(await publicState(token));
    }

    if (action === 'invoice') {
      if (!link.paid_at) return json({ error: 'Facture disponible après réception du paiement' }, 400);
      const res = await invoicePdf(link.order_id, link);
      if (!res) return json({ error: 'Facture indisponible' }, 404);
      return new Response(res.bytes, {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="Facture-${res.order.invoice_number || res.order.order_number}.pdf"`,
        },
      });
    }

    return json({ error: 'Action inconnue' }, 400);
  } catch (e) {
    console.error('[instagram-order]', (e as Error).message);
    return json({ error: 'Erreur serveur' }, 500);
  }
});
