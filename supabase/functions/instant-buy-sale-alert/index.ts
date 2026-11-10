// Edge Function : instant-buy-sale-alert
//
// Envoie à l'admin un email pour chaque article vendu depuis l'onglet
// « Achat immédiat » de l'espace pro (table instant_buy_sale_alerts, 0260) :
// la pièce n'est pas encore achetée chez le fournisseur, il faut l'acheter
// tout de suite (Buy It Now Aucnet, memo « oz »).
//
// Appelée par le trigger de 0260 à chaque vente, et toutes les 5 minutes par
// pg_cron tant qu'une alerte reste en attente. Ne lit rien de la requête :
// traite uniquement les lignes en attente → appel public sans risque.
// Idempotente : chaque ligne est réservée (claimed_at) avant l'envoi, puis
// marquée sent_at ; 5 tentatives maximum.
//
// Destinataire : secret INSTANT_BUY_ALERT_EMAIL (sinon l'email admin ci-dessous).
// Envoi : Resend, même expéditeur que les autres emails (RESEND_API_KEY).
//
// Déploiement : `supabase functions deploy instant-buy-sale-alert --no-verify-jwt`

import { createClient } from 'npm:@supabase/supabase-js@2';

const LOG_PREFIX = '[instant-buy-sale-alert]';
const DEFAULT_TO = 'badis.ozeparis@gmail.com';
const ADMIN_URL = 'https://admin.ozeparis.com/espace-b2b/achat-immediat';
const AUCNET_SEARCH_URL = 'https://u.brand-auc.com/previewSearch';
const MAX_ATTEMPTS = 5;
const CLAIM_TIMEOUT_MS = 2 * 60 * 1000;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const esc = (s: unknown) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const fmtEUR = (n: unknown) =>
  n == null || n === '' ? '—' : Number(n).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });

// "893-19622 (Aucnet)" → "893-19622"
const cleanRef = (ref: string | null) => (ref ? ref.replace(/\s*\(.*\)\s*$/, '').trim() : '');

Deno.serve(async () => {
  const resendApiKey = Deno.env.get('RESEND_API_KEY');
  if (!resendApiKey) return json({ error: 'RESEND_API_KEY manquant' }, 500);
  const to = Deno.env.get('INSTANT_BUY_ALERT_EMAIL') || DEFAULT_TO;
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // Réserve les alertes en attente (non envoyées, pas déjà prises par un autre appel).
  const nowIso = new Date().toISOString();
  const staleIso = new Date(Date.now() - CLAIM_TIMEOUT_MS).toISOString();
  const { data: claimed, error: claimError } = await admin
    .from('instant_buy_sale_alerts')
    .update({ claimed_at: nowIso })
    .is('sent_at', null)
    .lt('attempts', MAX_ATTEMPTS)
    .or(`claimed_at.is.null,claimed_at.lt.${staleIso}`)
    .select('id, product_id, attempts');
  if (claimError) return json({ error: claimError.message }, 500);
  if (!claimed?.length) return json({ sent: 0 });

  let sent = 0;
  const errors: { id: string; error: string }[] = [];

  for (const alert of claimed) {
    try {
      const { data: p, error: pErr } = await admin
        .from('products')
        .select('id, name, brand_id, source_reference, source_platform, reference, b2b_reference, purchase_price, sale_price, condition, images, main_image_index, reserved_by_reseller_id, instant_sold_at')
        .eq('id', alert.product_id)
        .single();
      if (pErr || !p) throw new Error(pErr?.message || 'Produit introuvable');

      let brand = '';
      if (p.brand_id) {
        const { data: b } = await admin.from('brands').select('name').eq('id', p.brand_id).maybeSingle();
        brand = b?.name ?? '';
      }

      let buyer = '';
      if (p.reserved_by_reseller_id) {
        const { data: r } = await admin.from('resellers').select('company_name').eq('id', p.reserved_by_reseller_id).maybeSingle();
        buyer = r?.company_name ?? '';
      }

      const ref = cleanRef(p.source_reference || p.reference);
      const platform = p.source_platform || (/^\d{3}-\d{5}$/.test(ref) ? 'Aucnet' : '');
      const images: string[] = Array.isArray(p.images) ? p.images : [];
      const image = images[p.main_image_index ?? 0] || images[0] || '';
      const soldAt = new Date(p.instant_sold_at || Date.now()).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });

      const subject = `🛒 Achat immédiat vendu : ${ref || p.name} — à acheter sur ${platform || 'le fournisseur'}`;
      const html = `
<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#111">
  <h2 style="margin:0 0 8px">Pièce vendue en achat immédiat</h2>
  <p style="margin:0 0 16px;color:#444">À acheter maintenant${platform ? ` sur <b>${esc(platform)}</b>` : ''}, avec le memo <b>oz</b>.</p>
  <div style="font-size:28px;font-weight:bold;letter-spacing:1px;padding:12px 16px;background:#f4f4f4;border-radius:8px;margin-bottom:16px">${esc(ref || '— référence manquante —')}</div>
  ${image ? `<img src="${esc(image)}" alt="" style="max-width:100%;border-radius:8px;margin-bottom:16px">` : ''}
  <table style="width:100%;border-collapse:collapse;font-size:14px">
    <tr><td style="padding:4px 0;color:#666">Article</td><td style="padding:4px 0"><b>${esc([brand, p.name].filter(Boolean).join(' — '))}</b></td></tr>
    <tr><td style="padding:4px 0;color:#666">État</td><td style="padding:4px 0">${esc(p.condition || '—')}</td></tr>
    <tr><td style="padding:4px 0;color:#666">Prix d'achat prévu</td><td style="padding:4px 0">${fmtEUR(p.purchase_price)}</td></tr>
    <tr><td style="padding:4px 0;color:#666">Vendu à</td><td style="padding:4px 0">${fmtEUR(p.sale_price)}${buyer ? ` — ${esc(buyer)}` : ''}</td></tr>
    <tr><td style="padding:4px 0;color:#666">Vendu le</td><td style="padding:4px 0">${esc(soldAt)}</td></tr>
    <tr><td style="padding:4px 0;color:#666">Réf. B2B</td><td style="padding:4px 0">${esc(p.b2b_reference || '—')}</td></tr>
  </table>
  <p style="margin:20px 0 8px">
    ${platform === 'Aucnet' ? `<a href="${AUCNET_SEARCH_URL}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:10px 16px;border-radius:6px;margin-right:8px">Ouvrir Aucnet</a>` : ''}
    <a href="${ADMIN_URL}" style="display:inline-block;border:1px solid #111;color:#111;text-decoration:none;padding:10px 16px;border-radius:6px">Voir dans l'admin</a>
  </p>
  <p style="font-size:12px;color:#888">Sur Aucnet : Preview search → coche « Buy It Now » → colle la référence dans « Item number ».</p>
</div>`;

      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: 'OZE PARIS <nepasrepondre@ozeparis.com>', to: [to], subject, html }),
      });
      if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);

      await admin.from('instant_buy_sale_alerts')
        .update({ sent_at: new Date().toISOString(), attempts: alert.attempts + 1, last_error: null })
        .eq('id', alert.id);
      sent++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`${LOG_PREFIX} Alerte ${alert.id} non envoyée :`, message);
      errors.push({ id: alert.id, error: message });
      await admin.from('instant_buy_sale_alerts')
        .update({ attempts: alert.attempts + 1, last_error: message.slice(0, 500), claimed_at: null })
        .eq('id', alert.id);
    }
  }

  return json({ sent, errors });
});
