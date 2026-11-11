// Edge Function : sav-send-invoice
//
// Assistant SAV (outil get_facture de sav-chat) : envoie par email au client
// connecté la facture d'une de ses commandes. Le PDF est celui rendu par le
// générateur existant de l'espace pro (même facture que « Télécharger la
// facture », mention « TVA non applicable, art. 293 B du CGI »), déposé par
// le navigateur dans le bucket privé sav-attachments ; à défaut (facture
// officielle Qonto), le lien du PDF Qonto est envoyé.
//
// Contrôles : JWT ; commande du compte revendeur connecté ET passée par ce
// profil (même règle que generate_invoice_for_order) ; fichier dans le
// dossier du compte ; destinataire = email du profil connecté uniquement ;
// 10 envois par heure.
//
// Body : { order_id, path? }
// Déploiement : `supabase functions deploy sav-send-invoice`

import { createClient } from 'npm:@supabase/supabase-js@2';
import { encode as base64Encode } from 'https://deno.land/std@0.190.0/encoding/base64.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const esc = (s: unknown) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const layout = (p: { title: string; paragraphs: string[]; cta?: { label: string; url: string } }) => `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/></head>
<body style="margin:0;background:#f6f6f6;font-family:Helvetica,Arial,sans-serif;color:#111;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;">
    <div style="padding:28px 32px;text-align:center;border-bottom:1px solid #eee;">
      <img src="https://ozeparis.com/logov4.PNG" alt="OZË PARIS" width="140" style="height:auto;max-width:140px;display:inline-block;" />
    </div>
    <div style="padding:32px;">
      <h1 style="font-size:20px;font-weight:600;margin:0 0 16px;">${p.title}</h1>
      ${p.paragraphs.map((x) => `<p style="font-size:14px;color:#555;margin:0 0 12px;line-height:1.5;">${x}</p>`).join('')}
      ${p.cta ? `<div style="text-align:center;margin:28px 0 8px;"><a href="${esc(p.cta.url)}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 28px;">${p.cta.label}</a></div>` : ''}
      <p style="font-size:13px;color:#777;margin-top:28px;">L'équipe OZË PARIS</p>
    </div>
    <div style="padding:18px 32px;text-align:center;font-size:11px;color:#aaa;border-top:1px solid #eee;">OZË PARIS — Club B2B</div>
  </div>
</body></html>`;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    if (!resendApiKey) return json({ error: 'Envoi d\'email indisponible' }, 503);

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Non authentifié' }, 401);
    const caller = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await caller.auth.getUser();
    if (!user) return json({ error: 'Non authentifié' }, 401);
    const { data: resellerId } = await caller.rpc('current_reseller_id_incl_ended');
    if (!resellerId) return json({ error: 'Compte revendeur introuvable' }, 403);

    const { order_id, path } = await req.json();
    if (!order_id) return json({ error: 'order_id requis' }, 400);

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data: allowed } = await admin.rpc('sav_rate_hit', { p_key: `invoice:${user.id}`, p_window: '1 hour', p_max: 10 });
    if (allowed === false) return json({ error: 'Trop d\'envois de factures : réessayez dans une heure.' }, 429);

    const { data: profile } = await admin.from('profiles').select('email, first_name').eq('id', user.id).maybeSingle();
    const { data: order } = await admin
      .from('orders')
      .select('id, order_number, email, reseller_id, placed_by_profile_id')
      .eq('id', order_id)
      .maybeSingle();
    if (!order || order.reseller_id !== resellerId || !(order.placed_by_profile_id === user.id || (profile?.email && order.email === profile.email))) {
      return json({ error: 'Commande introuvable sur votre compte' }, 404);
    }
    const to = profile?.email;
    if (!to) return json({ error: 'Adresse email introuvable' }, 400);

    const { data: inv } = await admin
      .from('invoices')
      .select('invoice_number, pdf_url, merged_into_invoice_id')
      .eq('order_id', order_id)
      .eq('kind', 'order')
      .maybeSingle();

    let attachments: { filename: string; content: string }[] = [];
    let link: string | null = null;
    if (path) {
      if (typeof path !== 'string' || !path.startsWith(`${resellerId}/`) || path.includes('..') || !path.endsWith('.pdf')) {
        return json({ error: 'Fichier invalide' }, 400);
      }
      const { data: file } = await admin.storage.from('sav-attachments').download(path);
      if (!file) return json({ error: 'Facture introuvable' }, 404);
      attachments = [{ filename: `OZE-Paris_Facture_${order.order_number}.pdf`, content: base64Encode(new Uint8Array(await file.arrayBuffer())) }];
    } else {
      link = inv?.pdf_url ?? null;
      if (!link) return json({ error: 'Facture introuvable' }, 404);
    }

    const hello = profile?.first_name ? `Bonjour ${esc(profile.first_name)},` : 'Bonjour,';
    const html = layout({
      title: `Votre facture${inv?.invoice_number ? ` ${esc(inv.invoice_number)}` : ''}`,
      paragraphs: [
        hello,
        `Comme demandé à notre assistant, voici la facture de votre commande <strong>${esc(order.order_number)}</strong>${attachments.length ? ' en pièce jointe' : ''}.`,
        'Elle reste aussi téléchargeable à tout moment depuis « Mes commandes » sur votre espace pro.',
      ],
      cta: link ? { label: 'Télécharger la facture', url: link } : undefined,
    });

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'OZE PARIS <nepasrepondre@ozeparis.com>',
        to: [to],
        subject: `Votre facture — commande ${order.order_number}`,
        html,
        ...(attachments.length ? { attachments } : {}),
      }),
    });
    if (!res.ok) {
      console.error('[sav-send-invoice] Resend', res.status, await res.text());
      return json({ error: 'Envoi de l\'email impossible' }, 502);
    }
    return json({ sent: true, to });
  } catch (e) {
    console.error('[sav-send-invoice]', e);
    return json({ error: e instanceof Error ? e.message : 'Erreur' }, 500);
  }
});
