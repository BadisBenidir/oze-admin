// Edge Function : reseller-password-reset
//
// « Mot de passe oublié » de l'écran de connexion (pro.ozeparis.com /
// admin.ozeparis.com), appel public avec la clé anon :
//   - email inconnu : réponse identique à un envoi réussi (on ne révèle pas
//     quels emails ont un compte) ;
//   - sous-compte d'une entreprise / d'un accompagnement (contact non
//     principal d'un revendeur 'company') : pas de réinitialisation en libre
//     service → code 'contact_admin', l'interface invite à contacter
//     l'administrateur de son entreprise (le contact principal, ou OZË, peut
//     réinitialiser son accès depuis « Mon équipe » / l'admin) ;
//   - sinon (abonné, contact principal, admin...) : code de réinitialisation
//     envoyé par email (Resend), à recopier sur l'écran de connexion
//     (supabase.auth.verifyOtp type 'recovery').
//
// Un CODE plutôt qu'un lien : les antivirus des messageries suivent les liens
// des emails et consomment les liens à usage unique (même choix que
// l'invitation, voir AcceptInvite.tsx).
//
// Secrets : RESEND_API_KEY
// Déploiement : `supabase functions deploy reseller-password-reset`

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const esc = (s: unknown) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const SENT = { status: 'sent' };

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  let email = '';
  try {
    const body = await req.json();
    email = typeof body.email === 'string' ? body.email.trim().toLowerCase().slice(0, 254) : '';
  } catch {
    return reply({ error: 'Requête invalide' }, 400);
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return reply({ error: 'Email invalide' }, 400);

  const resendApiKey = Deno.env.get('RESEND_API_KEY');
  if (!resendApiKey) {
    console.error('[reseller-password-reset] RESEND_API_KEY absent');
    return reply({ error: 'Service momentanément indisponible, réessayez plus tard.' }, 500);
  }

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const { data: profile } = await admin
    .from('profiles')
    .select('id, email, first_name, role')
    // ilike = insensible à la casse ; % et _ échappés (le _ est courant dans un email).
    .ilike('email', email.replace(/[\\%_]/g, '\\$&'))
    .maybeSingle();
  if (!profile) return reply(SENT);

  if (profile.role === 'reseller') {
    const { data: contact } = await admin
      .from('reseller_contacts')
      .select('is_primary, resellers!inner(account_type)')
      .eq('profile_id', profile.id)
      .maybeSingle();
    const reseller = contact && (Array.isArray(contact.resellers) ? contact.resellers[0] : contact.resellers);
    const accountType = reseller?.account_type ?? 'company';
    if (contact && !contact.is_primary && accountType !== 'subscriber') {
      return reply({ code: 'contact_admin' });
    }
  }

  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: 'recovery', email: profile.email });
  const code = link?.properties?.email_otp;
  if (linkError || !code) {
    console.error('[reseller-password-reset] generateLink :', linkError?.message);
    return reply({ error: 'Impossible de générer le code, réessayez dans un instant.' }, 500);
  }

  const hello = profile.first_name ? `Bonjour ${esc(profile.first_name)},` : 'Bonjour,';
  const html = `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/></head>
<body style="margin:0;background:#f6f6f6;font-family:Helvetica,Arial,sans-serif;color:#111;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;">
    <div style="padding:28px 32px;text-align:center;border-bottom:1px solid #eee;">
      <img src="https://ozeparis.com/logov4.PNG" alt="OZË PARIS" width="140" style="height:auto;max-width:140px;display:inline-block;" />
    </div>
    <div style="padding:32px;">
      <h1 style="font-size:20px;font-weight:600;margin:0 0 8px;">Réinitialisation de votre mot de passe</h1>
      <p style="font-size:14px;color:#555;margin:0 0 6px;">${hello}</p>
      <p style="font-size:14px;color:#555;margin:0 0 24px;">
        Voici votre code pour choisir un nouveau mot de passe. Recopiez-le sur l'écran de connexion :
      </p>
      <div style="text-align:center;margin:0 0 24px;">
        <span style="display:inline-block;font-size:30px;font-weight:700;letter-spacing:8px;padding:14px 24px;background:#f4f4f4;border:1px solid #e5e5e5;">${esc(code)}</span>
      </div>
      <p style="font-size:13px;color:#777;margin:0;">
        Ce code est valable une heure. Si vous n'êtes pas à l'origine de cette demande, ignorez cet email : votre mot de passe reste inchangé.
      </p>
      <p style="font-size:13px;color:#777;margin-top:28px;">L'équipe OZË PARIS</p>
    </div>
    <div style="padding:18px 32px;text-align:center;font-size:11px;color:#aaa;border-top:1px solid #eee;">
      OZË PARIS — Club B2B
    </div>
  </div>
</body></html>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'OZE PARIS <nepasrepondre@ozeparis.com>',
      to: [profile.email],
      subject: `Votre code de réinitialisation — OZË PARIS`,
      html,
    }),
  });
  if (!res.ok) {
    console.error('[reseller-password-reset] Échec Resend', res.status, await res.text());
    return reply({ error: 'L\'email n\'a pas pu être envoyé, réessayez dans un instant.' }, 500);
  }

  return reply(SENT);
});
