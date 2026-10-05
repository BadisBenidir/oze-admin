// Création du compte d'un abonné Club B2B À PARTIR D'UNE INSCRIPTION PAYÉE
// (b2b_pending_signups, 0175). Appelée par le webhook (checkout.session.completed)
// et par b2b-signup (action "status", page de remerciement plus rapide que le
// webhook) : idempotente, un second appel renvoie le compte déjà créé.
//
// Crée : compte de connexion (mot de passe haché choisi à l'inscription),
// profil revendeur, revendeur abonné (en 'pending' : c'est l'activation du
// webhook qui le passe en 'active' et enregistre l'abonnement) et son contact.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export type PendingSignup = {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  billing_address: string | null;
  billing_postal_code: string | null;
  billing_city: string | null;
  billing_country: string | null;
  plan: 'drops' | 'revendeur';
  password_hash: string;
  status: 'pending' | 'processing' | 'completed';
  reseller_id: string | null;
  profile_id: string | null;
  claimed_at: string | null;
};

const LOG_PREFIX = '[pending-signup]';
/** Une création interrompue (erreur, timeout) peut être reprise après ce délai. */
const STALE_CLAIM_MS = 2 * 60 * 1000;

export type FinalizeResult =
  | { status: 'completed'; resellerId: string; profileId: string }
  | { status: 'busy' }
  | { status: 'not_found' };

export async function finalizePendingSignup(admin: SupabaseClient, signupId: string): Promise<FinalizeResult> {
  const { data: row } = await admin.from('b2b_pending_signups').select('*').eq('id', signupId).maybeSingle<PendingSignup>();
  if (!row) return { status: 'not_found' };
  if (row.status === 'completed' && row.reseller_id && row.profile_id) {
    return { status: 'completed', resellerId: row.reseller_id, profileId: row.profile_id };
  }

  // Verrou : un seul appel crée le compte (webhook et page de remerciement
  // peuvent arriver en même temps). Un verrou trop ancien est repris.
  // Deux requêtes simples (un filtre .or() combiné échouait silencieusement :
  // aucun verrou n'était jamais pris, donc aucun compte jamais créé).
  const staleBefore = new Date(Date.now() - STALE_CLAIM_MS).toISOString();
  const claim = { status: 'processing', claimed_at: new Date().toISOString() };
  let { data: claimed, error: claimError } = await admin
    .from('b2b_pending_signups')
    .update(claim)
    .eq('id', signupId)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle();
  if (!claimed && !claimError) {
    ({ data: claimed, error: claimError } = await admin
      .from('b2b_pending_signups')
      .update(claim)
      .eq('id', signupId)
      .eq('status', 'processing')
      .lt('claimed_at', staleBefore)
      .select('id')
      .maybeSingle());
  }
  if (claimError) throw new Error(`verrou de l'inscription : ${claimError.message}`);
  if (!claimed) return { status: 'busy' };

  try {
    // 1. Compte de connexion (ou compte déjà créé lors d'un essai interrompu).
    let profileId = row.profile_id;
    // Compte créé par CE parcours (maintenant ou lors d'un essai interrompu) :
    // c'est lui qui reçoit le mot de passe choisi à l'inscription. Jamais un
    // compte qui existait déjà avant (son mot de passe n'est pas touché).
    let ownAccount = Boolean(row.profile_id);
    if (!profileId) {
      // createUser({ password_hash }) est refusé par ce projet (0183) : compte
      // créé avec un mot de passe temporaire aléatoire, remplacé juste après.
      const tempPassword = `${crypto.randomUUID()}${crypto.randomUUID()}`;
      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email: row.email,
        password: tempPassword,
        email_confirm: true,
        user_metadata: { first_name: row.first_name, last_name: row.last_name },
      });
      if (created?.user) {
        profileId = created.user.id;
        ownAccount = true;
      } else if (createError && /already|exists|registered/i.test(createError.message)) {
        const { data: existing } = await admin
          .from('profiles')
          .select('id')
          .ilike('email', row.email.replace(/[\\%_]/g, '\\$&'))
          .maybeSingle();
        if (!existing) throw new Error(`compte existant introuvable : ${createError.message}`);
        profileId = existing.id;
      } else {
        throw new Error(`création du compte : ${createError?.message}`);
      }
      await admin.from('b2b_pending_signups').update({ profile_id: profileId }).eq('id', signupId);
    }

    // Mot de passe choisi à l'inscription (haché bcrypt) posé sur le compte créé.
    if (ownAccount) {
      const { error: hashError } = await admin.rpc('set_auth_user_password_hash', {
        p_user_id: profileId,
        p_password_hash: row.password_hash,
      });
      if (hashError) throw new Error(`mot de passe : ${hashError.message}`);
    }

    // 2. Profil revendeur.
    const { error: profileError } = await admin.from('profiles').upsert({
      id: profileId,
      email: row.email,
      first_name: row.first_name,
      last_name: row.last_name,
      phone: row.phone,
      role: 'reseller',
      activated_at: new Date().toISOString(),
      last_invited_at: null,
    });
    if (profileError) throw new Error(`profil : ${profileError.message}`);

    // 3. Revendeur abonné (activé ensuite par le webhook).
    let resellerId = row.reseller_id;
    if (!resellerId) {
      const { data: reseller, error: resellerError } = await admin
        .from('resellers')
        .insert({
          company_name: `${row.first_name} ${row.last_name}`,
          status: 'pending',
          account_type: 'subscriber',
          subscription_plan: row.plan,
          contact_email: row.email,
          contact_phone: row.phone,
          address: row.billing_address,
          postal_code: row.billing_postal_code,
          city: row.billing_city,
          country: row.billing_country,
        })
        .select('id')
        .single();
      if (resellerError || !reseller) throw new Error(`revendeur : ${resellerError?.message}`);
      resellerId = reseller.id as string;
      await admin.from('b2b_pending_signups').update({ reseller_id: resellerId }).eq('id', signupId);
    }

    // 4. Contact (unique pour un abonné).
    const { data: contact } = await admin
      .from('reseller_contacts')
      .select('id')
      .eq('profile_id', profileId)
      .eq('reseller_id', resellerId)
      .maybeSingle();
    if (!contact) {
      const { error: contactError } = await admin
        .from('reseller_contacts')
        .insert({ reseller_id: resellerId, profile_id: profileId, is_primary: false });
      if (contactError) throw new Error(`contact : ${contactError.message}`);
    }

    await admin
      .from('b2b_pending_signups')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', signupId);
    console.log(`${LOG_PREFIX} Compte créé pour ${row.email} (revendeur ${resellerId})`);
    return { status: 'completed', resellerId, profileId };
  } catch (err) {
    // Libère le verrou : un prochain appel (retry du webhook) reprendra là où ça s'est arrêté.
    await admin.from('b2b_pending_signups').update({ status: 'pending', claimed_at: null }).eq('id', signupId);
    throw err;
  }
}
