// Email de bienvenue d'un abonné Club B2B (Pass Drops / Pass Revendeur),
// envoyé par handleSubscriptionCheckout une fois le compte activé : lien vers
// l'espace pro, étapes suivantes et facture Stripe du premier mois en pièce
// jointe (+ lien vers la facture en ligne).
//
// Même expéditeur et même service que les emails du site principal
// (oze-storefront/_shared/finalizeOrder.ts) : Resend, secret RESEND_API_KEY
// déjà présent sur le projet. Ne bloque jamais l'activation : toute erreur
// est seulement loguée.

import Stripe from 'https://esm.sh/stripe@17.7.0?target=deno';
import { encode as base64Encode } from 'https://deno.land/std@0.190.0/encoding/base64.ts';

const LOG_PREFIX = '[b2b-stripe-webhook:welcome-email]';
const PRO_URL = 'https://pro.ozeparis.com';
const PLAN_NAME = { drops: 'Pass Drops', revendeur: 'Pass Revendeur' } as const;

const esc = (s: unknown) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const fmtEUR = (cents: number | null | undefined, currency = 'eur') =>
  ((cents ?? 0) / 100).toLocaleString('fr-FR', { style: 'currency', currency: currency.toUpperCase() });

export async function sendSubscriptionWelcomeEmail(params: {
  stripe: Stripe;
  to: string;
  firstName: string | null;
  plan: 'drops' | 'revendeur' | null;
  invoiceId: string | null;
  returning: boolean;
}): Promise<void> {
  const resendApiKey = Deno.env.get('RESEND_API_KEY');
  if (!resendApiKey) {
    console.warn(`${LOG_PREFIX} RESEND_API_KEY absent → email non envoyé à ${params.to}`);
    return;
  }

  let invoice: Stripe.Invoice | null = null;
  if (params.invoiceId) {
    try {
      invoice = await params.stripe.invoices.retrieve(params.invoiceId);
    } catch (err) {
      console.warn(`${LOG_PREFIX} Facture ${params.invoiceId} introuvable :`, err instanceof Error ? err.message : err);
    }
  }

  const attachments: { filename: string; content: string }[] = [];
  if (invoice?.invoice_pdf) {
    try {
      const pdf = await fetch(invoice.invoice_pdf);
      if (pdf.ok) {
        attachments.push({
          filename: `Facture-${invoice.number || invoice.id}.pdf`,
          content: base64Encode(new Uint8Array(await pdf.arrayBuffer())),
        });
      }
    } catch (err) {
      console.warn(`${LOG_PREFIX} PDF de facture non joint :`, err instanceof Error ? err.message : err);
    }
  }

  const planName = params.plan ? PLAN_NAME[params.plan] : 'Club B2B';
  const hello = params.firstName ? `Bonjour ${esc(params.firstName)},` : 'Bonjour,';
  const title = params.returning ? 'Bon retour au Club B2B !' : 'Bienvenue au Club B2B !';
  const intro = params.returning
    ? `Votre <strong>${planName}</strong> est de nouveau actif : votre espace, vos commandes et votre solde vous attendent.`
    : `Votre <strong>${planName}</strong> est actif : vous avez désormais accès à l'espace pro OZË PARIS.`;
  const steps = [
    `Connectez-vous sur <a href="${PRO_URL}" style="color:#111;">pro.ozeparis.com</a> avec l'email et le mot de passe choisis à l'inscription.`,
    'Complétez votre statut juridique dans « Mon profil » : il est requis pour acheter.',
    params.plan === 'revendeur'
      ? 'Découvrez le catalogue, les drops, les sessions d\'enchères et le sourcing sur mesure.'
      : 'Découvrez le catalogue et les drops, avec les nouveautés en avant-première.',
  ];

  const invoiceBlock = invoice
    ? `<div style="margin-top:28px;padding-top:20px;border-top:1px solid #eee;">
        <div style="font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#999;margin-bottom:6px;">Votre facture</div>
        <table style="width:100%;border-collapse:collapse;font-size:14px;">
          <tr><td style="padding:4px 0;color:#555;">${esc(planName)}${invoice.number ? ` — n° ${esc(invoice.number)}` : ''}</td>
              <td style="padding:4px 0;text-align:right;font-weight:700;">${fmtEUR(invoice.amount_paid, invoice.currency)}</td></tr>
        </table>
        <p style="font-size:13px;color:#555;margin:10px 0 0;">
          ${attachments.length ? 'La facture est jointe à cet email. ' : ''}${invoice.hosted_invoice_url ? `<a href="${esc(invoice.hosted_invoice_url)}" style="color:#111;">Voir la facture en ligne</a>. ` : ''}Toutes vos factures sont disponibles dans « Mon profil » → « Mon abonnement ».
        </p>
      </div>`
    : '';

  const html = `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/></head>
<body style="margin:0;background:#f6f6f6;font-family:Helvetica,Arial,sans-serif;color:#111;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;">
    <div style="padding:28px 32px;text-align:center;border-bottom:1px solid #eee;">
      <img src="https://ozeparis.com/logov4.PNG" alt="OZË PARIS" width="140" style="height:auto;max-width:140px;display:inline-block;" />
    </div>
    <div style="padding:32px;">
      <h1 style="font-size:20px;font-weight:600;margin:0 0 8px;">${title}</h1>
      <p style="font-size:14px;color:#555;margin:0 0 6px;">${hello}</p>
      <p style="font-size:14px;color:#555;margin:0 0 24px;">${intro}</p>
      <ol style="font-size:14px;line-height:1.6;color:#111;padding-left:20px;margin:0;">
        ${steps.map((s) => `<li style="margin-bottom:6px;">${s}</li>`).join('')}
      </ol>
      <div style="text-align:center;margin:28px 0 4px;">
        <a href="${PRO_URL}/connexion?next=%2Fcatalogue" style="display:inline-block;background:#111;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 28px;">Accéder à mon espace</a>
      </div>
      ${invoiceBlock}
      <p style="font-size:13px;color:#777;margin-top:28px;">
        Une question ? Écrivez-nous à <a href="mailto:contact@ozeparis.com" style="color:#111;">contact@ozeparis.com</a>.<br/>À très vite,<br/>L'équipe OZË PARIS
      </p>
    </div>
    <div style="padding:18px 32px;text-align:center;font-size:11px;color:#aaa;border-top:1px solid #eee;">
      OZË PARIS — Club B2B · Abonnement sans engagement, résiliable depuis votre profil
    </div>
  </div>
</body></html>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'OZE PARIS <nepasrepondre@ozeparis.com>',
      to: [params.to],
      bcc: ['badis.ozeparis@gmail.com'],
      subject: params.returning ? `Votre ${planName} est réactivé — OZË PARIS` : `Bienvenue au Club B2B — votre ${planName} est actif`,
      html,
      ...(attachments.length ? { attachments } : {}),
    }),
  });
  if (!res.ok) {
    console.error(`${LOG_PREFIX} Échec Resend (${params.to})`, res.status, await res.text());
    return;
  }
  console.log(`${LOG_PREFIX} Email de bienvenue envoyé à ${params.to}${attachments.length ? ' (facture jointe)' : ''}`);
}
