// Email « Votre facture d'avance » d'une mission de sourcing sur mesure (0196),
// envoyé depuis nepasrepondre@ozeparis.com (Resend, même gabarit que les
// emails du Club B2B) — à la place de l'envoi Qonto, qui part toujours
// d'invoice@qonto.com. Lien vers la page publique de la facture Qonto
// (PDF officiel), coordonnées de virement et référence à indiquer.

const LOG_PREFIX = '[emit-qonto-invoice:email]';

const esc = (s: unknown) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const euros = (n: number) => n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const longDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' }) : null;
const formatIban = (iban: string) => iban.replace(/(.{4})/g, '$1 ').trim();

export interface AdvanceInvoiceEmailParams {
  to: string;
  firstName: string | null;
  missionTitle: string | null;
  missionReference: string | null;
  invoiceNumber: string;
  amount: number;
  dueDate: string | null;
  invoiceUrl: string | null;
  iban: string;
  bic: string;
  beneficiary: string;
}

/** Renvoie une erreur lisible si l'envoi échoue (jamais d'exception). */
export async function sendAdvanceInvoiceEmail(p: AdvanceInvoiceEmailParams): Promise<string | null> {
  const resendApiKey = Deno.env.get('RESEND_API_KEY');
  if (!resendApiKey) return 'RESEND_API_KEY absent : email non envoyé';

  const due = longDate(p.dueDate);
  const row = (label: string, value: string) =>
    `<tr><td style="padding:4px 12px 4px 0;color:#777;font-size:13px;white-space:nowrap;">${label}</td><td style="padding:4px 0;font-size:13px;color:#111;font-weight:600;">${value}</td></tr>`;

  const html = `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/></head>
<body style="margin:0;background:#f6f6f6;font-family:Helvetica,Arial,sans-serif;color:#111;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;">
    <div style="padding:28px 32px;text-align:center;border-bottom:1px solid #eee;">
      <img src="https://ozeparis.com/logov4.PNG" alt="OZË PARIS" width="140" style="height:auto;max-width:140px;display:inline-block;" />
    </div>
    <div style="padding:32px;">
      <h1 style="font-size:20px;font-weight:600;margin:0 0 16px;">Votre facture d'avance</h1>
      <p style="font-size:14px;color:#555;margin:0 0 12px;line-height:1.5;">${p.firstName ? `Bonjour ${esc(p.firstName)},` : 'Bonjour,'}</p>
      <p style="font-size:14px;color:#555;margin:0 0 12px;line-height:1.5;">
        Voici la facture de l'avance de votre sourcing sur mesure${p.missionTitle ? ` <strong>« ${esc(p.missionTitle)} »</strong>` : ''}${p.missionReference ? ` (réf. ${esc(p.missionReference)})` : ''}.
        Nous lançons les recherches dès réception du règlement.
      </p>
      <div style="background:#f6f6f6;padding:16px 18px;margin:20px 0;">
        <table style="border-collapse:collapse;">
          ${row('Facture', esc(p.invoiceNumber))}
          ${row('Montant', esc(euros(p.amount)))}
          ${due ? row('À régler avant le', esc(due)) : ''}
        </table>
      </div>
      <p style="font-size:14px;color:#555;margin:0 0 8px;line-height:1.5;">Règlement par virement bancaire :</p>
      <div style="border:1px solid #eee;padding:16px 18px;margin:0 0 20px;">
        <table style="border-collapse:collapse;">
          ${row('Bénéficiaire', esc(p.beneficiary))}
          ${row('IBAN', esc(formatIban(p.iban)))}
          ${row('BIC', esc(p.bic))}
          ${row('Référence', esc(p.invoiceNumber))}
        </table>
      </div>
      <p style="font-size:13px;color:#777;margin:0 0 12px;line-height:1.5;">Merci d'indiquer la référence <strong>${esc(p.invoiceNumber)}</strong> dans le libellé de votre virement.</p>
      ${p.invoiceUrl ? `<div style="text-align:center;margin:28px 0 8px;">
        <a href="${esc(p.invoiceUrl)}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 28px;">Voir et télécharger la facture</a>
      </div>` : ''}
      <p style="font-size:13px;color:#777;margin-top:28px;">
        Une question ? Écrivez-nous à <a href="mailto:contact@ozeparis.com" style="color:#111;">contact@ozeparis.com</a>.<br/>L'équipe OZË PARIS
      </p>
    </div>
    <div style="padding:18px 32px;text-align:center;font-size:11px;color:#aaa;border-top:1px solid #eee;">
      OZË PARIS — Sourcing sur mesure
    </div>
  </div>
</body></html>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'OZE PARIS <nepasrepondre@ozeparis.com>',
      to: [p.to],
      bcc: ['badis.ozeparis@gmail.com'],
      subject: `Votre facture d'avance ${p.invoiceNumber} — OZË PARIS`,
      html,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error(`${LOG_PREFIX} Échec Resend (${p.to})`, res.status, body);
    return `Échec de l'envoi de l'email (${res.status})`;
  }
  console.log(`${LOG_PREFIX} facture d'avance ${p.invoiceNumber} envoyée à ${p.to}`);
  return null;
}
