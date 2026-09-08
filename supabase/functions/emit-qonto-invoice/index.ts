// Edge Function : emit-qonto-invoice
//
// Émission RÉELLE d'une facture via l'API Qonto (Business API) pour une
// commande déjà payée : crée/synchronise le client Qonto (POST /v2/clients,
// mis en cache sur profiles.qonto_client_id), émet la facture officielle
// (POST /v2/client_invoices, finalize:true) et enregistre son PDF/numéro
// officiel sur la ligne `invoices` correspondante (voir 0118).
//
// ⚠️ Implémenté au plus près du payload fourni pour cette intégration, sans
// accès à un compte Qonto réel pour valider les noms de champs exacts de la
// réponse (`client.id`, `invoice.id`/`number`/`pdf_url`/`status`...) — même
// réserve que qonto-sync (synchro bancaire) : à vérifier au premier appel
// réel et ajuster si l'API Qonto diffère de ce qui est documenté ici.
//
// Émission volontairement RÉSERVÉE AUX ADMINS (jamais auto-déclenchée par un
// clic client sur "Télécharger la facture") : une émission Qonto finalisée
// est un acte irréversible qui crée un vrai document légal côté Qonto — pas
// un geste à répéter par erreur ou à déclencher sans supervision tant que
// cette intégration n'a pas été validée en conditions réelles. Idempotent :
// si invoices.qonto_invoice_id est déjà renseigné, renvoie l'existant sans
// ré-émettre.
//
// Déploiement : `supabase functions deploy emit-qonto-invoice`

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const QONTO_BASE_URL = 'https://thirdparty.qonto.com/v2';

// Mention légale obligatoire — OZË Paris est en franchise en base de TVA
// (art. 293 B du CGI, voir config/legal.ts et Terms.tsx), jamais en régime
// de TVA sur la marge (art. 297 A) : la note transmise à Qonto reflète le
// régime réel de l'entreprise, pas celui indiqué dans une demande antérieure.
const VAT_NOTE = 'TVA non applicable, article 293 B du Code Général des Impôts (franchise en base de TVA).';

// Qonto exige un ISO 3166-1 alpha-2 STRICT (2 caractères) sur
// billing_address.country_code — un 422 réel a confirmé qu'une valeur en
// toutes lettres ("France") ou plus longue est rejetée. Filet de sécurité
// en plus de country_name_to_iso (0117, appliqué à l'écriture du profil) :
// couvre aussi profiles.country (adresse personnelle, jamais normalisée par
// cette fonction SQL) et toute valeur déjà mal formée arrivant malgré tout.
const COUNTRY_NAME_TO_ISO: Record<string, string> = {
  france: 'FR', fr: 'FR',
  belgique: 'BE', be: 'BE',
  suisse: 'CH', ch: 'CH',
  luxembourg: 'LU', lu: 'LU',
  monaco: 'MC', mc: 'MC',
};
const toIsoCountryCode = (value: string | null | undefined): string => {
  const normalized = (value || '').trim().toLowerCase();
  const mapped = COUNTRY_NAME_TO_ISO[normalized] || value || 'FR';
  return (mapped.trim().toUpperCase().slice(0, 2) || 'FR');
};

interface OrderItemRow {
  id: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  status: string | null;
  product_snapshot: { name?: string; condition?: string } | null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Non authentifié' }, 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    // Le caller doit être admin — vérifié via SON PROPRE jeton (jamais via
    // service-role), pour que public.is_admin()/RLS voient le même auth.uid()
    // qu'un appel normal depuis le dashboard admin.
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await callerClient.auth.getUser();
    if (userError || !user) return json({ error: 'Non authentifié' }, 401);

    const { data: callerProfile } = await callerClient.from('profiles').select('role').eq('id', user.id).maybeSingle();
    if (callerProfile?.role !== 'admin') {
      return json({ error: 'Accès refusé : réservé aux administrateurs' }, 403);
    }

    const { order_id } = await req.json();
    if (!order_id) return json({ error: 'order_id est requis' }, 400);

    const secretKey = Deno.env.get('QONTO_SECRET_KEY');
    const orgSlug = Deno.env.get('QONTO_ORGANIZATION_SLUG');
    if (!secretKey || !orgSlug) {
      return json({ error: 'QONTO_SECRET_KEY / QONTO_ORGANIZATION_SLUG manquants dans les secrets Supabase' }, 500);
    }
    const qontoHeaders = {
      Authorization: `${orgSlug}:${secretKey}`,
      'Content-Type': 'application/json',
    };

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // 1. S'assure que la ligne `invoices` interne existe déjà (numérotation
    // FAC-YYYY-NNNNN, billing_details figés) — réutilise le même chemin que
    // le téléchargement jsPDF (generate_invoice_for_order, 0115/0117),
    // appelé via le jeton de l'admin (pas service-role) pour que
    // public.is_admin() y voie bien un admin.
    const { data: genData, error: genError } = await callerClient.rpc('generate_invoice_for_order', { p_order_id: order_id });
    if (genError) return json({ error: genError.message }, 400);

    const { data: invoiceRow, error: invoiceFetchError } = await adminClient
      .from('invoices')
      .select('id, invoice_number, legal_status, profile_id, qonto_invoice_id, pdf_url')
      .eq('order_id', order_id)
      .single();
    if (invoiceFetchError || !invoiceRow) {
      return json({ error: invoiceFetchError?.message || 'Facture introuvable après génération' }, 400);
    }

    // Idempotent : jamais de double émission.
    if (invoiceRow.qonto_invoice_id) {
      return json({
        success: true,
        already_emitted: true,
        qonto_invoice_id: invoiceRow.qonto_invoice_id,
        pdf_url: invoiceRow.pdf_url,
      });
    }

    const { data: profile, error: profileError } = await adminClient
      .from('profiles')
      .select(
        'id, email, first_name, last_name, address, city, postal_code, country, ' +
          'legal_status, legal_entity_name, legal_form, siret, vat_number, legal_address, legal_city, legal_postal_code, legal_country, ' +
          'qonto_client_id'
      )
      .eq('id', invoiceRow.profile_id)
      .single();
    if (profileError || !profile) return json({ error: profileError?.message || 'Profil client introuvable' }, 400);

    const { data: order, error: orderError } = await adminClient
      .from('orders')
      .select('id, order_number, created_at')
      .eq('id', order_id)
      .single();
    if (orderError || !order) return json({ error: orderError?.message || 'Commande introuvable' }, 400);

    const { data: items } = await adminClient
      .from('order_items')
      .select('id, quantity, unit_price, line_total, status, product_snapshot')
      .eq('order_id', order_id);
    const activeItems = ((items || []) as OrderItemRow[]).filter((i) => i.status !== 'cancelled');

    // 2. Client Qonto — créé une seule fois par profil, réutilisé ensuite.
    let qontoClientId = profile.qonto_client_id as string | null;
    if (!qontoClientId) {
      const isPro = profile.legal_status !== 'individual';
      // `kind` obligatoire (422 sans lui) : 'individual' pour un particulier,
      // 'company' pour une EI comme pour une société (Qonto ne distingue pas
      // ces deux dernières à ce niveau, seulement via identification_number/
      // legal_form). L'adresse doit être imbriquée sous `billing_address`,
      // country_code strictement en 2 lettres (voir toIsoCountryCode).
      const clientPayload: Record<string, unknown> = isPro
        ? {
            kind: 'company',
            name: profile.legal_entity_name,
            email: profile.email,
            vat_number: profile.vat_number || undefined,
            legal_form: profile.legal_form || undefined,
            identification_number: profile.siret,
            billing_address: {
              address: profile.legal_address,
              city: profile.legal_city,
              zip_code: profile.legal_postal_code,
              country_code: toIsoCountryCode(profile.legal_country),
            },
          }
        : {
            kind: 'individual',
            first_name: profile.first_name,
            last_name: profile.last_name,
            email: profile.email,
            billing_address: {
              address: profile.address,
              city: profile.city,
              zip_code: profile.postal_code,
              country_code: toIsoCountryCode(profile.country),
            },
          };

      const clientRes = await fetch(`${QONTO_BASE_URL}/clients`, {
        method: 'POST',
        headers: qontoHeaders,
        body: JSON.stringify(clientPayload),
      });
      if (!clientRes.ok) {
        const body = await clientRes.text();
        return json({ error: `Qonto /clients a échoué (${clientRes.status}) : ${body}` }, 502);
      }
      const clientData = await clientRes.json();
      qontoClientId = clientData?.client?.id || clientData?.id;
      if (!qontoClientId) {
        return json({ error: 'Qonto /clients a répondu sans id de client exploitable', raw: clientData }, 502);
      }
      await adminClient.from('profiles').update({ qonto_client_id: qontoClientId }).eq('id', profile.id);
    }

    // 3. IBAN de règlement — vérifié et nettoyé AVANT tout appel, pour
    // échouer avec un message explicite plutôt qu'un 422 Qonto opaque si le
    // secret manque côté Supabase.
    const qontoIban = (Deno.env.get('QONTO_IBAN') || '').replace(/\s+/g, '').toUpperCase();
    if (!qontoIban) {
      return json({ error: 'Secret QONTO_IBAN manquant dans Supabase' }, 500);
    }
    console.log('emit-qonto-invoice: QONTO_IBAN lu, longueur', qontoIban.length, 'préfixe', qontoIban.slice(0, 4));

    // Le secret QONTO_IBAN est confirmé non-vide (log ci-dessus) et pourtant
    // Qonto renvoie "invalid_iban"/"IBAN is empty" quel que soit l'endroit
    // où `iban` est placé en ATTRIBUT — en JSON:API strict, le compte
    // bancaire de règlement est plus probablement une RELATION
    // (relationships.bank_account), pas un attribut. Résolution de son id
    // via /v2/organizations, comme qonto-sync.
    const orgRes = await fetch(`${QONTO_BASE_URL}/organizations/${orgSlug}`, { headers: qontoHeaders });
    if (!orgRes.ok) {
      const body = await orgRes.text();
      return json({ error: `Qonto /organizations a échoué (${orgRes.status}) : ${body}` }, 502);
    }
    const orgData = await orgRes.json();
    const bankAccounts = orgData?.organization?.bank_accounts || [];
    const settlementAccount = bankAccounts.find((a: { iban?: string }) => a.iban === qontoIban) || bankAccounts[0];
    const bankAccountId: string | undefined = settlementAccount?.id || settlementAccount?.slug;
    console.log('emit-qonto-invoice: bank_account résolu ?', Boolean(bankAccountId), 'iban match ?', settlementAccount?.iban === qontoIban);

    // 4. Émission de la facture officielle, finalisée (numéro officiel +
    // routage PDP automatique côté Qonto pour un client pro). Le 422 réel
    // (pointers /data/attributes/... au format JSON:API) révèle une
    // enveloppe { data: { attributes: {...} } }, jamais un payload plat, et
    // des items imbriqués sous attributes.sections[].items[] — chaque item
    // porte SA PROPRE currency (en plus de celle d'unit_price). customer_locale
    // obligatoire également.
    const today = new Date().toISOString().slice(0, 10);
    const invoicePayload = {
      data: {
        attributes: {
          client_id: qontoClientId,
          currency: 'EUR',
          customer_locale: 'fr',
          issue_date: today,
          due_date: today,
          // "invalid_iban"/"IBAN is empty" a persisté identiquement à la
          // racine du payload, sous bank_account_id ET sous payment_methods
          // imbriqué — le champ exact reste incertain, donc envoyé ici à
          // deux endroits plausibles (payment_methods.iban ET iban en
          // attribut direct) : un champ non reconnu par Qonto est ignoré
          // sans erreur, jamais de risque à en couvrir plusieurs.
          iban: qontoIban,
          payment_methods: {
            iban: qontoIban,
          },
          sections: [
            {
              items: activeItems.map((item) => ({
                title: [item.product_snapshot?.name, item.product_snapshot?.condition].filter(Boolean).join(' — ') || 'Article',
                quantity: String(item.quantity || '1'),
                currency: 'EUR',
                unit_price: { value: item.unit_price.toFixed(2), currency: 'EUR' },
                // OZË Paris est en franchise en base de TVA (art. 293 B du
                // CGI) : jamais de TVA facturée.
                vat_rate: '0',
              })),
            },
          ],
          note: VAT_NOTE,
          finalize: true,
        },
        // Relation JSON:API vers le compte bancaire de règlement — couvre
        // l'hypothèse que le compte s'exprime en `relationships`, pas en
        // attribut plat, tant que ni `iban` ni `payment_methods.iban` en
        // attribut n'ont fonctionné.
        ...(bankAccountId
          ? { relationships: { bank_account: { data: { type: 'bank_accounts', id: bankAccountId } } } }
          : {}),
      },
    };

    console.log('emit-qonto-invoice: payload attributes keys', Object.keys(invoicePayload.data.attributes));

    const invoiceRes = await fetch(`${QONTO_BASE_URL}/client_invoices`, {
      method: 'POST',
      headers: qontoHeaders,
      body: JSON.stringify(invoicePayload),
    });
    if (!invoiceRes.ok) {
      const body = await invoiceRes.text();
      return json({ error: `Qonto /client_invoices a échoué (${invoiceRes.status}) : ${body}` }, 502);
    }
    const invoiceData = await invoiceRes.json();
    // Réponse probablement au même format JSON:API que la requête
    // (data.attributes) — on couvre aussi les formes plus plates au cas où
    // la réponse ne suit pas exactement la même enveloppe que l'entrée.
    const qontoInvoice =
      invoiceData?.data?.attributes || invoiceData?.data || invoiceData?.client_invoice || invoiceData?.invoice || invoiceData;
    // En JSON:API, `id` vit au niveau de la ressource (data.id), pas dans
    // attributes — vérifié en priorité avant le repli sur qontoInvoice.id.
    const qontoInvoiceId: string | undefined = invoiceData?.data?.id || qontoInvoice?.id;
    const qontoInvoiceNumber: string | undefined = qontoInvoice?.number || qontoInvoice?.invoice_number;
    const pdfUrl: string | undefined = qontoInvoice?.pdf_url || qontoInvoice?.document_url || qontoInvoice?.url;
    const rawStatus: string | undefined = qontoInvoice?.status || qontoInvoice?.transmission_status;

    if (!qontoInvoiceId) {
      return json({ error: 'Qonto /client_invoices a répondu sans id de facture exploitable', raw: invoiceData }, 502);
    }

    const transmissionStatus = ['pending', 'sent', 'failed', 'direct_pdf'].includes(rawStatus || '')
      ? rawStatus
      : profile.legal_status === 'individual'
      ? 'direct_pdf'
      : 'pending';

    const { error: updateError } = await adminClient
      .from('invoices')
      .update({
        qonto_invoice_id: qontoInvoiceId,
        qonto_invoice_number: qontoInvoiceNumber || null,
        pdf_url: pdfUrl || null,
        transmission_status: transmissionStatus,
      })
      .eq('id', invoiceRow.id);
    if (updateError) return json({ error: updateError.message }, 500);

    return json({
      success: true,
      already_emitted: false,
      qonto_invoice_id: qontoInvoiceId,
      qonto_invoice_number: qontoInvoiceNumber,
      pdf_url: pdfUrl,
      transmission_status: transmissionStatus,
      internal_invoice_number: genData?.invoice_number || invoiceRow.invoice_number,
    });
  } catch (err) {
    console.error('emit-qonto-invoice: erreur non gérée', err instanceof Error ? err.stack || err.message : err);
    return json({ error: err instanceof Error ? err.message : 'Erreur inconnue' }, 500);
  }
});
