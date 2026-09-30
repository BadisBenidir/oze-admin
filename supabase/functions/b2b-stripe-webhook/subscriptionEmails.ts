// Emails de suivi des abonnements Club B2B (en plus du bienvenue, voir
// welcomeEmail.ts) :
//   - relance d'une inscription dont le paiement n'a pas été finalisé
//     (checkout.session.expired) ;
//   - échec d'un prélèvement mensuel (invoice.payment_failed) ;
//   - facture de chaque échéance payée (invoice.paid), PDF joint.
// Même expéditeur et même service (Resend) que les autres emails ; jamais
// bloquant pour le webhook.

import { encode as base64Encode } from 'https://deno.land/std@0.190.0/encoding/base64.ts';

const LOG_PREFIX = '[b2b-stripe-webhook:emails]';
const PRO_URL = 'https://pro.ozeparis.com';

const esc = (s: unknown) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const layout = (params: { title: string; paragraphs: string[]; cta: { label: string; url: string }; footerNote?: string }) => `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/></head>
<body style="margin:0;background:#f6f6f6;font-family:Helvetica,Arial,sans-serif;color:#111;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;">
    <div style="padding:28px 32px;text-align:center;border-bottom:1px solid #eee;">
      <img src="https://ozeparis.com/logov4.PNG" alt="OZË PARIS" width="140" style="height:auto;max-width:140px;display:inline-block;" />
    </div>
    <div style="padding:32px;">
      <h1 style="font-size:20px;font-weight:600;margin:0 0 16px;">${params.title}</h1>
      ${params.paragraphs.map((p) => `<p style="font-size:14px;color:#555;margin:0 0 12px;line-height:1.5;">${p}</p>`).join('')}
      <div style="text-align:center;margin:28px 0 8px;">
        <a href="${esc(params.cta.url)}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 28px;">${params.cta.label}</a>
      </div>
      ${params.footerNote ? `<p style="font-size:13px;color:#777;margin-top:20px;">${params.footerNote}</p>` : ''}
      <p style="font-size:13px;color:#777;margin-top:28px;">
        Une question ? Écrivez-nous à <a href="mailto:contact@ozeparis.com" style="color:#111;">contact@ozeparis.com</a>.<br/>L'équipe OZË PARIS
      </p>
    </div>
    <div style="padding:18px 32px;text-align:center;font-size:11px;color:#aaa;border-top:1px solid #eee;">
      OZË PARIS — Club B2B
    </div>
  </div>
</body></html>`;

async function send(
  to: string,
  subject: string,
  html: string,
  attachments: { filename: string; content: string }[] = [],
  copyToAdmin = true,
): Promise<void> {
  const resendApiKey = Deno.env.get('RESEND_API_KEY');
  if (!resendApiKey) {
    console.warn(`${LOG_PREFIX} RESEND_API_KEY absent → « ${subject} » non envoyé à ${to}`);
    return;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'OZE PARIS <nepasrepondre@ozeparis.com>',
      to: [to],
      ...(copyToAdmin ? { bcc: ['badis.ozeparis@gmail.com'] } : {}),
      subject,
      html,
      ...(attachments.length ? { attachments } : {}),
    }),
  });
  if (!res.ok) console.error(`${LOG_PREFIX} Échec Resend (${to})`, res.status, await res.text());
  else console.log(`${LOG_PREFIX} « ${subject} » envoyé à ${to}`);
}

/** Inscription commencée mais paiement jamais finalisé. */
export const sendAbandonedSignupEmail = (to: string, firstName: string | null, planName: string) =>
  send(
    to,
    `Votre inscription au Club B2B n'est pas terminée`,
    layout({
      title: 'Il ne manque plus que le paiement',
      paragraphs: [
        firstName ? `Bonjour ${esc(firstName)},` : 'Bonjour,',
        `Vous avez commencé votre inscription au <strong>${esc(planName)}</strong>, mais le paiement n'a pas été finalisé. Votre compte est créé et vous attend : connectez-vous avec l'email et le mot de passe choisis, puis validez votre pass en quelques secondes.`,
        'Drops en avant-première, catalogue de pièces authentifiées, expédition groupée quand vous voulez : tout est prêt.',
      ],
      cta: { label: 'Finaliser mon inscription', url: `${PRO_URL}/connexion?next=%2Fcatalogue` },
      footerNote: 'Mot de passe oublié ? Cliquez sur « Mot de passe oublié ? » sur l\'écran de connexion.',
    }),
  );

/** Prélèvement mensuel refusé : lien pour régler l'échéance avec une autre carte. */
export const sendPaymentFailedEmail = (params: {
  to: string;
  firstName: string | null;
  planName: string;
  amount: string;
  payUrl: string | null;
  finalAttempt: boolean;
}) =>
  send(
    params.to,
    params.finalAttempt ? 'Dernier rappel : votre abonnement Club B2B va être suspendu' : 'Le paiement de votre abonnement Club B2B a échoué',
    layout({
      title: params.finalAttempt ? 'Votre accès va être suspendu' : 'Votre paiement n\'a pas abouti',
      paragraphs: [
        params.firstName ? `Bonjour ${esc(params.firstName)},` : 'Bonjour,',
        `Le prélèvement de <strong>${esc(params.amount)}</strong> pour votre ${esc(params.planName)} a été refusé par votre banque (carte expirée, plafond atteint, fonds insuffisants…).`,
        params.finalAttempt
          ? 'C\'était la dernière tentative : sans règlement, votre accès à l\'espace pro sera suspendu. Vos commandes, votre solde et vos informations restent conservés.'
          : 'Une nouvelle tentative sera faite automatiquement dans quelques jours. Pour éviter toute coupure, réglez l\'échéance dès maintenant ou mettez à jour votre carte.',
      ],
      cta: { label: 'Régler mon abonnement', url: params.payUrl || `${PRO_URL}/mon-profil` },
      footerNote: `Vous pouvez aussi mettre à jour votre carte depuis <a href="${PRO_URL}/mon-profil" style="color:#111;">« Mon profil » → « Mon abonnement »</a>.`,
    }),
  );

/**
 * Facture d'une échéance payée (renouvellement mensuel, ou différence au
 * prorata lors du passage au Pass Revendeur), PDF Stripe en pièce jointe.
 * Pas de copie à l'admin : une facture par abonné et par mois.
 */
export async function sendSubscriptionInvoiceEmail(params: {
  to: string;
  firstName: string | null;
  planName: string;
  invoiceNumber: string | null;
  amount: string;
  periodLabel: string | null;
  pdfUrl: string | null;
  hostedUrl: string | null;
  isPlanChange: boolean;
}): Promise<void> {
  const attachments: { filename: string; content: string }[] = [];
  if (params.pdfUrl) {
    try {
      const pdf = await fetch(params.pdfUrl);
      if (pdf.ok) {
        attachments.push({
          filename: `Facture-${params.invoiceNumber || 'OZE'}.pdf`,
          content: base64Encode(new Uint8Array(await pdf.arrayBuffer())),
        });
      }
    } catch (err) {
      console.warn(`${LOG_PREFIX} PDF de facture non joint :`, err instanceof Error ? err.message : err);
    }
  }

  const what = params.isPlanChange
    ? `la différence de prix liée à votre passage au <strong>${esc(params.planName)}</strong>`
    : `votre <strong>${esc(params.planName)}</strong>${params.periodLabel ? ` pour ${esc(params.periodLabel)}` : ''}`;

  await send(
    params.to,
    `Votre facture ${params.invoiceNumber ? `${params.invoiceNumber} ` : ''}— Club B2B OZË PARIS`,
    layout({
      title: 'Votre facture est disponible',
      paragraphs: [
        params.firstName ? `Bonjour ${esc(params.firstName)},` : 'Bonjour,',
        `Merci ! Nous avons bien reçu votre paiement de <strong>${esc(params.amount)}</strong> pour ${what}.`,
        `${attachments.length ? 'Votre facture est jointe à cet email. ' : ''}Toutes vos factures restent disponibles dans « Mon profil » → « Mon abonnement ».`,
      ],
      cta: params.hostedUrl
        ? { label: 'Voir la facture en ligne', url: params.hostedUrl }
        : { label: 'Accéder à mon espace', url: `${PRO_URL}/mon-profil` },
    }),
    attachments,
    false,
  );
}
