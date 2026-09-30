// Coordonnées de facturation d'un abonné Club B2B côté Stripe : les factures
// d'abonnement doivent porter l'identité légale déclarée dans « Mon profil »
// (dénomination, SIRET, TVA intracommunautaire, adresse du siège), pas le seul
// prénom/nom saisi à l'inscription.
//
// Appelé par b2b-subscription (action "sync_billing", après l'enregistrement
// du statut juridique) et par le webhook à l'activation d'un abonnement.
// Ne s'applique qu'aux factures émises APRÈS la synchronisation (Stripe ne
// modifie jamais une facture déjà finalisée).

import Stripe from 'https://esm.sh/stripe@17.7.0?target=deno';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

type LegalProfile = {
  first_name: string | null;
  last_name: string | null;
  legal_status: 'individual' | 'sole_proprietorship' | 'company' | null;
  legal_entity_name: string | null;
  siret: string | null;
  vat_number: string | null;
  legal_address: string | null;
  legal_city: string | null;
  legal_postal_code: string | null;
  legal_country: string | null;
};

// Pays du formulaire de profil → code ISO attendu par Stripe.
const COUNTRY_CODES: Record<string, string> = {
  france: 'FR', belgique: 'BE', suisse: 'CH', luxembourg: 'LU', allemagne: 'DE', espagne: 'ES',
  italie: 'IT', 'pays-bas': 'NL', portugal: 'PT', monaco: 'MC', 'royaume-uni': 'GB', autriche: 'AT', irlande: 'IE',
};

export const countryCode = (country: string | null): string | undefined => {
  if (!country) return undefined;
  const trimmed = country.trim();
  if (/^[A-Za-z]{2}$/.test(trimmed)) return trimmed.toUpperCase();
  return COUNTRY_CODES[trimmed.toLowerCase()];
};

/** Met à jour le client Stripe avec l'identité légale du profil. Renvoie false si rien à synchroniser. */
export async function syncStripeBillingIdentity(
  stripe: Stripe,
  admin: SupabaseClient,
  profileId: string,
  customerId: string,
): Promise<boolean> {
  const { data: profile } = await admin
    .from('profiles')
    .select('first_name, last_name, legal_status, legal_entity_name, siret, vat_number, legal_address, legal_city, legal_postal_code, legal_country')
    .eq('id', profileId)
    .maybeSingle<LegalProfile>();
  if (!profile?.legal_status) return false;

  const isBusiness = profile.legal_status !== 'individual';
  const personName = [profile.first_name, profile.last_name].filter(Boolean).join(' ').trim();
  const name = (isBusiness && profile.legal_entity_name?.trim()) || personName || undefined;

  const customFields: { name: string; value: string }[] = [];
  if (isBusiness && profile.siret?.trim()) customFields.push({ name: 'SIRET', value: profile.siret.trim().slice(0, 140) });

  await stripe.customers.update(customerId, {
    ...(name ? { name } : {}),
    ...(profile.legal_address && profile.legal_city
      ? {
          address: {
            line1: profile.legal_address.slice(0, 200),
            city: profile.legal_city,
            postal_code: profile.legal_postal_code || undefined,
            country: countryCode(profile.legal_country),
          },
        }
      : {}),
    preferred_locales: ['fr'],
    // '' efface un ancien SIRET si le profil n'en a plus (ex. passage en particulier).
    invoice_settings: { custom_fields: customFields.length ? customFields : '' },
  });

  // TVA intracommunautaire : ajoutée une seule fois (Stripe refuse les doublons).
  const vat = profile.vat_number?.replace(/\s/g, '').toUpperCase();
  if (isBusiness && vat) {
    try {
      const existing = await stripe.customers.listTaxIds(customerId, { limit: 10 });
      if (!existing.data.some((t) => t.value.replace(/\s/g, '').toUpperCase() === vat)) {
        await stripe.customers.createTaxId(customerId, { type: 'eu_vat', value: vat });
      }
    } catch (err) {
      // Numéro au format refusé par Stripe : le reste de l'identité est bien synchronisé.
      console.warn('[stripeBilling] TVA non ajoutée :', err instanceof Error ? err.message : err);
    }
  }
  return true;
}
