// Edge Function : sav-notify
//
// Envoie les emails du SAV en attente dans sav_email_outbox (0263 / 0265) :
//   - ticket_created  : confirmation au client (n° + lien vers sa demande) ;
//   - team_new_ticket : alerte équipe (SAV_TEAM_EMAIL), objet « URGENT » si urgent ;
//   - team_reply      : « Nouvelle réponse à votre demande #… » (extrait + bouton) ;
//   - resolved        : demande passée en « Résolu ».
// Le client ne répond pas par email : les boutons mènent à la demande sur
// pro.ozeparis.com.
//
// Appelée par les triggers de 0265 et toutes les 5 minutes par pg_cron tant
// qu'un email reste en attente. Ne lit rien de la requête (appel public sans
// risque) ; idempotente (réservation puis sent_at), 5 tentatives maximum.
//
// Secrets : RESEND_API_KEY, SAV_TEAM_EMAIL (défaut sav@ozeparis.com),
// PRO_SITE_URL (défaut https://pro.ozeparis.com).
// Déploiement : `supabase functions deploy sav-notify --no-verify-jwt`

import { createClient } from 'npm:@supabase/supabase-js@2';
import { SAV_CATEGORIES } from '../_shared/savKnowledge.ts';

const LOG_PREFIX = '[sav-notify]';
const MAX_ATTEMPTS = 5;
const ADMIN_URL = 'https://admin.ozeparis.com/sav/tickets';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const esc = (s: unknown) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const excerpt = (s: string, max = 400) => {
  const t = s.trim().replace(/\s+\n/g, '\n');
  return t.length > max ? `${t.slice(0, max).trimEnd()}…` : t;
};

const layout = (p: { title: string; paragraphs: string[]; quote?: string; cta: { label: string; url: string }; note?: string; footer?: string }) => `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/></head>
<body style="margin:0;background:#f6f6f6;font-family:Helvetica,Arial,sans-serif;color:#111;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;">
    <div style="padding:28px 32px;text-align:center;border-bottom:1px solid #eee;">
      <img src="https://ozeparis.com/logov4.PNG" alt="OZË PARIS" width="140" style="height:auto;max-width:140px;display:inline-block;" />
    </div>
    <div style="padding:32px;">
      <h1 style="font-size:20px;font-weight:600;margin:0 0 16px;">${p.title}</h1>
      ${p.paragraphs.map((x) => `<p style="font-size:14px;color:#555;margin:0 0 12px;line-height:1.5;">${x}</p>`).join('')}
      ${p.quote ? `<div style="margin:18px 0;padding:14px 16px;background:#f6f6f6;border-left:3px solid #111;font-size:14px;color:#333;line-height:1.5;white-space:pre-wrap;">${esc(p.quote)}</div>` : ''}
      <div style="text-align:center;margin:28px 0 8px;">
        <a href="${esc(p.cta.url)}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 28px;">${p.cta.label}</a>
      </div>
      ${p.note ? `<p style="font-size:12px;color:#888;margin-top:20px;line-height:1.5;">${p.note}</p>` : ''}
      <p style="font-size:13px;color:#777;margin-top:28px;">L'équipe OZË PARIS</p>
    </div>
    <div style="padding:18px 32px;text-align:center;font-size:11px;color:#aaa;border-top:1px solid #eee;">
      ${p.footer ?? 'OZË PARIS — Club B2B'}
    </div>
  </div>
</body></html>`;

const NO_REPLY_NOTE = 'Merci de ne pas répondre à cet email : pour nous écrire, répondez directement sur votre demande dans votre espace pro.';

Deno.serve(async () => {
  const resendApiKey = Deno.env.get('RESEND_API_KEY');
  if (!resendApiKey) return json({ error: 'RESEND_API_KEY manquant' }, 500);
  const teamEmail = Deno.env.get('SAV_TEAM_EMAIL') || 'sav@ozeparis.com';
  const proUrl = (Deno.env.get('PRO_SITE_URL') || 'https://pro.ozeparis.com').replace(/\/$/, '');
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const { data: claimed, error: claimError } = await admin.rpc('sav_claim_emails', { p_max_attempts: MAX_ATTEMPTS });
  if (claimError) return json({ error: claimError.message }, 500);
  if (!claimed?.length) return json({ sent: 0 });

  let sent = 0;
  const errors: { id: string; error: string }[] = [];

  for (const job of claimed as { id: string; ticket_id: string; message_id: string | null; kind: string }[]) {
    try {
      const { data: t } = await admin
        .from('sav_tickets')
        .select('id, number, subject, category, priority, status, source, reseller:resellers(company_name, contact_email), creator:profiles!sav_tickets_created_by_profile_id_fkey(first_name, last_name, email), order:orders(order_number)')
        .eq('id', job.ticket_id)
        .maybeSingle();
      if (!t) throw new Error('ticket introuvable');

      const creator = t.creator as { first_name: string | null; last_name: string | null; email: string | null } | null;
      const reseller = t.reseller as { company_name: string | null; contact_email: string | null } | null;
      const order = t.order as { order_number: string | null } | null;
      const clientEmail = creator?.email || reseller?.contact_email;
      const hello = creator?.first_name ? `Bonjour ${esc(creator.first_name)},` : 'Bonjour,';
      const ticketUrl = `${proUrl}/mes-demandes/${encodeURIComponent(t.number)}`;

      let to: string | null | undefined;
      let subject = '';
      let html = '';

      if (job.kind === 'ticket_created') {
        to = clientEmail;
        subject = `Votre demande ${t.number} a bien été reçue`;
        html = layout({
          title: `Demande ${esc(t.number)} reçue`,
          paragraphs: [
            hello,
            `Nous avons bien reçu votre demande « <strong>${esc(t.subject)}</strong> »${order?.order_number ? ` concernant la commande ${esc(order.order_number)}` : ''}. Notre équipe va l'étudier et vous répondra sur votre espace pro ; vous serez prévenu(e) par email.`,
          ],
          cta: { label: 'Suivre ma demande', url: ticketUrl },
          note: NO_REPLY_NOTE,
        });
      } else if (job.kind === 'team_reply') {
        const { data: m } = await admin.from('sav_ticket_messages').select('content, attachments').eq('id', job.message_id!).maybeSingle();
        if (!m) throw new Error('message introuvable');
        const photos = Array.isArray(m.attachments) && m.attachments.length ? `\n\n(${m.attachments.length} pièce(s) jointe(s) à voir sur votre espace)` : '';
        to = clientEmail;
        subject = `Nouvelle réponse à votre demande #${t.number}`;
        html = layout({
          title: 'Nouvelle réponse de l\'équipe OZË',
          paragraphs: [hello, `Nous avons répondu à votre demande <strong>${esc(t.number)}</strong> « ${esc(t.subject)} » :`],
          quote: excerpt(m.content || '') + photos,
          cta: { label: 'Voir et répondre', url: ticketUrl },
          // Réponse + « Résolu » d'un même geste : un seul email (0265).
          note:
            t.status === 'resolved'
              ? `Votre demande est désormais marquée comme résolue. Si quelque chose ne vous convient pas, répondez sur la demande : elle sera rouverte. ${NO_REPLY_NOTE}`
              : NO_REPLY_NOTE,
        });
      } else if (job.kind === 'resolved') {
        to = clientEmail;
        subject = `Votre demande #${t.number} est résolue`;
        html = layout({
          title: 'Demande résolue',
          paragraphs: [
            hello,
            `Votre demande <strong>${esc(t.number)}</strong> « ${esc(t.subject)} » est désormais marquée comme résolue.`,
            'Si quelque chose ne vous convient pas, il vous suffit de répondre sur la demande depuis votre espace pro : elle sera rouverte.',
          ],
          cta: { label: 'Voir ma demande', url: ticketUrl },
          note: NO_REPLY_NOTE,
        });
      } else if (job.kind === 'team_new_ticket') {
        const { data: first } = await admin
          .from('sav_ticket_messages')
          .select('content')
          .eq('ticket_id', t.id)
          .order('created_at')
          .limit(1)
          .maybeSingle();
        const urgent = t.priority === 'urgent';
        const priorityLabel = { low: 'Basse', normal: 'Normale', high: 'Haute', urgent: 'URGENTE' }[t.priority as string] || t.priority;
        const who = [creator?.first_name, creator?.last_name].filter(Boolean).join(' ') || creator?.email || '—';
        to = teamEmail;
        subject = `${urgent ? '🔴 URGENT — ' : ''}Nouveau ticket ${t.number} : ${t.subject}`;
        html = layout({
          title: `${urgent ? '🔴 ' : ''}Nouveau ticket ${esc(t.number)}`,
          paragraphs: [
            `<strong>${esc(reseller?.company_name || '—')}</strong> · ${esc(who)}`,
            `Catégorie : ${esc(SAV_CATEGORIES[t.category as string] || t.category)} · Priorité : <strong>${esc(priorityLabel)}</strong>${order?.order_number ? ` · Commande ${esc(order.order_number)}` : ''} · ${t.source === 'chatbot' ? 'ouvert par le chatbot' : 'formulaire'}`,
            `Sujet : ${esc(t.subject)}`,
          ],
          quote: first?.content ? excerpt(first.content, 800) : undefined,
          cta: { label: 'Ouvrir le SAV', url: ADMIN_URL },
          footer: 'OZË PARIS — SAV (notification interne)',
        });
      }

      if (!to) throw new Error('destinataire introuvable');
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: 'OZE PARIS <nepasrepondre@ozeparis.com>', to: [to], subject, html }),
      });
      if (!res.ok) throw new Error(`Resend ${res.status} : ${await res.text()}`);

      await admin.rpc('sav_finish_email', { p_id: job.id, p_sent: true });
      sent++;
      console.log(`${LOG_PREFIX} ${job.kind} ${t.number} → ${to}`);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(`${LOG_PREFIX} ${job.kind} ${job.ticket_id}`, message);
      errors.push({ id: job.id, error: message });
      await admin.rpc('sav_finish_email', { p_id: job.id, p_sent: false, p_error: message });
    }
  }

  return json({ sent, errors });
});
