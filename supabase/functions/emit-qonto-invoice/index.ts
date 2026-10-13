// Edge Function : emit-qonto-invoice
//
// Émission RÉELLE d'une facture via l'API Qonto (Business API) pour une
// commande déjà payée : crée/synchronise le client Qonto (POST /v2/clients,
// mis en cache sur profiles.qonto_client_id), émet la facture officielle
// (POST /v2/client_invoices, finalize:true) et enregistre son PDF/numéro
// officiel sur la ligne `invoices` correspondante (voir 0118).
//
// Structure du payload POST /v2/client_invoices et de sa réponse CONFIRMÉE
// par des appels réels réussis (201) contre l'API Qonto pendant le
// diagnostic de ce fichier, sur un client individuel ET un client société :
// payload plat (jamais d'enveloppe JSON:API), payment_methods en objet
// unique, items[].unit_price en objet Amount {value, currency}. Le client
// (/v2/clients) doit impérativement porter locale/currency/billing_address.
// street_address/tax_identification_number (jamais address/identification_
// number) — sans locale/currency, Qonto crée le client (200) mais refuse
// ENSUITE toute facture pour lui ("customer/locale"/"customer/currency must
// have a value"), d'où le PATCH de rattrapage sur les clients déjà en cache.
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
import { sendAdvanceInvoiceEmail } from './advanceInvoiceEmail.ts';

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
  insured: boolean | null;
  insurance_cost: number | null;
  entrupy_requested: boolean | null;
  entrupy_cost: number | null;
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

    // order_id : facture d'une commande ; sourcing_mission_id : facture
    // d'avance d'une mission de sourcing sur mesure (0196), émise avant toute
    // commande pour demander le paiement de l'avance.
    // resend_email : renvoie seulement l'email de la facture d'avance déjà
    // émise (aucune nouvelle émission Qonto).
    const { order_id, sourcing_mission_id, resend_email } = await req.json();
    if (!order_id && !sourcing_mission_id) return json({ error: 'order_id ou sourcing_mission_id est requis' }, 400);

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
    const { data: genData, error: genError } = sourcing_mission_id
      ? await callerClient.rpc('generate_advance_invoice_for_mission', { p_mission_id: sourcing_mission_id })
      : await callerClient.rpc('generate_invoice_for_order', { p_order_id: order_id });
    if (genError) return json({ error: genError.message }, 400);

    const { data: invoiceRow, error: invoiceFetchError } = await adminClient
      .from('invoices')
      .select('id, invoice_number, legal_status, profile_id, qonto_invoice_id, pdf_url, kind, sourcing_mission_id, total_amount')
      .eq(sourcing_mission_id ? 'sourcing_mission_id' : 'order_id', sourcing_mission_id || order_id)
      .single();
    if (invoiceFetchError || !invoiceRow) {
      return json({ error: invoiceFetchError?.message || 'Facture introuvable après génération' }, 400);
    }

    // Coordonnées du compte de règlement — la structure ci-dessous est
    // CONFIRMÉE par un appel réel réussi (201) contre l'API Qonto. IBAN
    // vérifié avant tout appel, pour un message explicite si le secret manque.
    const getSettlement = async (): Promise<{ iban: string; bic: string; beneficiary: string } | { error: string }> => {
      const iban = (Deno.env.get('QONTO_IBAN') || '').replace(/\s+/g, '').toUpperCase();
      if (!iban) return { error: 'Secret QONTO_IBAN manquant dans Supabase' };
      const orgRes = await fetch(`${QONTO_BASE_URL}/organizations/${orgSlug}`, { headers: qontoHeaders });
      if (!orgRes.ok) return { error: `Qonto /organizations a échoué (${orgRes.status}) : ${await orgRes.text()}` };
      const bankAccounts = (await orgRes.json())?.organization?.bank_accounts || [];
      const account = bankAccounts.find((a: { iban?: string }) => a.iban === iban) || bankAccounts[0];
      return { iban, bic: account?.bic || 'QNTOFRP1XXX', beneficiary: 'OZË PARIS' };
    };

    // Email « Votre facture d'avance » depuis nepasrepondre@ozeparis.com
    // (Qonto, lui, enverrait depuis invoice@qonto.com) — relit la facture
    // Qonto pour son numéro officiel, son échéance et sa page publique.
    const emailAdvanceInvoice = async (qontoInvoiceId: string, profileId: string, missionId: string | null): Promise<string | null> => {
      const [{ data: member }, { data: mission }, qontoRes, settlement] = await Promise.all([
        adminClient.from('profiles').select('email, first_name').eq('id', profileId).maybeSingle(),
        missionId
          ? adminClient.from('b2b_sourcing_missions').select('reference, title').eq('id', missionId).maybeSingle()
          : Promise.resolve({ data: null }),
        fetch(`${QONTO_BASE_URL}/client_invoices/${qontoInvoiceId}`, { headers: qontoHeaders }),
        getSettlement(),
      ]);
      if (!member?.email) return 'Email du membre introuvable';
      if ('error' in settlement) return settlement.error;
      const qontoInvoice = qontoRes.ok ? (await qontoRes.json())?.client_invoice : null;
      return sendAdvanceInvoiceEmail({
        to: member.email,
        firstName: member.first_name,
        missionTitle: mission?.title ?? null,
        missionReference: mission?.reference ?? null,
        invoiceNumber: qontoInvoice?.number || invoiceRow.invoice_number,
        amount: Number(invoiceRow.total_amount),
        dueDate: qontoInvoice?.due_date ?? null,
        invoiceUrl: qontoInvoice?.invoice_url ?? invoiceRow.pdf_url ?? null,
        ...settlement,
      });
    };

    if (resend_email) {
      if (invoiceRow.kind !== 'advance' || !invoiceRow.qonto_invoice_id) {
        return json({ error: "Seule une facture d'avance déjà émise sur Qonto peut être renvoyée par email" }, 400);
      }
      const emailError = await emailAdvanceInvoice(invoiceRow.qonto_invoice_id, invoiceRow.profile_id, invoiceRow.sourcing_mission_id);
      if (emailError) return json({ error: emailError }, 502);
      return json({ success: true, email_sent: true });
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

    // Facture d'avance (0196) : une seule ligne, le montant de l'avance —
    // y compris quand elle a été rattachée ensuite à la commande de la mission.
    const isAdvance = invoiceRow.kind === 'advance';

    // Factures de commande : émission Qonto (facturation B2B Factur-X)
    // réservée aux clients professionnels (Société ou EI) ; un particulier
    // reste sur le PDF jsPDF standard (invoice_type = 'b2c_retail'). La
    // facture d'avance, elle, sert à demander le paiement : ouverte à tous
    // les membres, particuliers compris (client Qonto « individual »).
    if (!isAdvance && profile.legal_status === 'individual') {
      return json({ error: "L'émission sur Qonto est réservée aux clients professionnels (Société ou EI), pas aux particuliers" }, 400);
    }
    let advanceLine: { title: string; amount: number } | null = null;
    let activeItems: OrderItemRow[] = [];
    if (isAdvance) {
      const { data: mission } = await adminClient
        .from('b2b_sourcing_missions')
        .select('reference, title')
        .eq('id', invoiceRow.sourcing_mission_id)
        .maybeSingle();
      const rawTitle = ['Avance — Sourcing sur mesure', mission?.reference, mission?.title].filter(Boolean).join(' — ');
      advanceLine = { title: rawTitle.length > 120 ? rawTitle.slice(0, 119) + '…' : rawTitle, amount: Number(invoiceRow.total_amount) };
    } else {
      const { data: order, error: orderError } = await adminClient
        .from('orders')
        .select('id, order_number, created_at')
        .eq('id', order_id)
        .single();
      if (orderError || !order) return json({ error: orderError?.message || 'Commande introuvable' }, 400);

      const { data: items } = await adminClient
        .from('order_items')
        .select('id, quantity, unit_price, line_total, status, product_snapshot, insured, insurance_cost, entrupy_requested, entrupy_cost')
        .eq('order_id', order_id);
      activeItems = ((items || []) as OrderItemRow[]).filter((i) => i.status !== 'cancelled');
    }

    // 2. Client Qonto — créé une seule fois par profil, réutilisé ensuite.
    // Champs CONFIRMÉS par des 422 réels sur un client société : `locale`
    // et `currency` sont obligatoires pour pouvoir émettre une facture à ce
    // client (absents, sans eux Qonto refuse TOUTE facture pour ce client
    // avec "customer/locale"/"customer/currency must have a value"), et
    // l'adresse va sous billing_address.street_address (jamais `address`),
    // le SIRET sous tax_identification_number (jamais identification_number).
    const isPro = profile.legal_status !== 'individual';
    const clientPayload: Record<string, unknown> = isPro
      ? {
          kind: 'company',
          name: profile.legal_entity_name,
          email: profile.email,
          locale: 'fr',
          currency: 'EUR',
          vat_number: profile.vat_number || undefined,
          legal_form: profile.legal_form || undefined,
          tax_identification_number: profile.siret,
          billing_address: {
            street_address: profile.legal_address,
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
          locale: 'fr',
          currency: 'EUR',
          billing_address: {
            street_address: profile.address,
            city: profile.city,
            zip_code: profile.postal_code,
            country_code: toIsoCountryCode(profile.country),
          },
        };

    let qontoClientId = profile.qonto_client_id as string | null;
    if (!qontoClientId) {
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
    } else {
      // Rattrapage : un client déjà mis en cache a pu être créé AVANT ce
      // correctif (locale/currency/street_address manquants) — un PATCH
      // idempotent le complète systématiquement avant chaque émission,
      // sans jamais avoir besoin de connaître son état réel au préalable.
      const patchRes = await fetch(`${QONTO_BASE_URL}/clients/${qontoClientId}`, {
        method: 'PATCH',
        headers: qontoHeaders,
        body: JSON.stringify(clientPayload),
      });
      if (!patchRes.ok) {
        const body = await patchRes.text();
        console.error('emit-qonto-invoice: PATCH /clients a échoué (non bloquant)', patchRes.status, body);
      }
    }

    // 3. Compte de règlement (voir getSettlement). Structure du payload
    // CONFIRMÉE par des appels réels réussis (201) :
    //   - payload PLAT (jamais d'enveloppe { data: { attributes } })
    //   - payment_methods est un OBJET UNIQUE (pas un tableau)
    //   - items[].unit_price est un objet Amount { value, currency }
    //     (jamais une string ni un nombre brut) ; items[].quantity et
    //     .vat_rate restent des strings.
    //   - il n'y a pas de champ `note` ni `customer_locale` sur la facture ;
    //     la mention légale va dans `footer`.
    const settlement = await getSettlement();
    if ('error' in settlement) return json({ error: settlement.error }, 502);
    const { iban: qontoIban, bic: settlementBic, beneficiary: beneficiaryName } = settlement;

    // 4. Émission de la facture officielle (numéro officiel + routage PDP
    // automatique côté Qonto pour un client pro).
    const today = new Date().toISOString().slice(0, 10);
    // Une facture de commande est déjà réglée (échéance = émission) ; une
    // facture d'avance demande le paiement : échéance à 7 jours.
    const dueDate = isAdvance ? new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString().slice(0, 10) : today;
    const invoicePayload = {
      client_id: qontoClientId,
      currency: 'EUR',
      issue_date: today,
      due_date: dueDate,
      payment_methods: {
        type: 'transfer',
        beneficiary_name: beneficiaryName,
        iban: qontoIban,
        bic: settlementBic,
      },
      // Assurance transport et certificat Entrupy : inclus dans
      // orders.total_amount, donc facturés sur des lignes dédiées (sinon la
      // facture Qonto était inférieure au montant réellement payé).
      items: advanceLine ? [{
        title: advanceLine.title,
        quantity: '1',
        unit_price: { value: advanceLine.amount.toFixed(2), currency: 'EUR' },
        vat_rate: '0',
      }] : activeItems.flatMap((item) => {
        const rawTitle = String(
          [item.product_snapshot?.name, item.product_snapshot?.condition].filter(Boolean).join(' — ') || 'Article'
        );
        // Qonto rejette (422) tout `title` de plus de 120 caractères — les
        // noms de produits luxe + condition peuvent facilement dépasser
        // cette limite, ce qui faisait échouer l'émission de la facture.
        const QONTO_ITEM_TITLE_MAX = 120;
        const title = rawTitle.length > QONTO_ITEM_TITLE_MAX
          ? rawTitle.slice(0, QONTO_ITEM_TITLE_MAX - 1) + '…'
          : rawTitle;
        const productName = String(item.product_snapshot?.name || 'Article').slice(0, 80);
        // OZË Paris est en franchise en base de TVA (art. 293 B du CGI) :
        // jamais de TVA facturée.
        const lines = [{
          title,
          quantity: String(item.quantity || '1'),
          unit_price: { value: Number(item.unit_price || 1).toFixed(2), currency: 'EUR' },
          vat_rate: '0',
        }];
        const insurance = Number(item.insurance_cost) || 0;
        if (item.insured && insurance > 0) {
          lines.push({
            title: `Assurance transport — ${productName}`,
            quantity: '1',
            unit_price: { value: insurance.toFixed(2), currency: 'EUR' },
            vat_rate: '0',
          });
        }
        const entrupy = Number(item.entrupy_cost) || 0;
        if (item.entrupy_requested && entrupy > 0) {
          lines.push({
            title: `Certificat Entrupy — ${productName}`,
            quantity: '1',
            unit_price: { value: entrupy.toFixed(2), currency: 'EUR' },
            vat_rate: '0',
          });
        }
        return lines;
      }),
      footer: VAT_NOTE,
      finalize: true,
    };

    console.log('Qonto POST Body:', JSON.stringify(invoicePayload, null, 2));

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
    // Réponse CONFIRMÉE par un vrai 201 pendant le diagnostic :
    // { client_invoice: { id, number, invoice_url, status, ... } }.
    const qontoInvoice = invoiceData?.client_invoice;
    const qontoInvoiceId: string | undefined = qontoInvoice?.id;
    const qontoInvoiceNumber: string | undefined = qontoInvoice?.number;
    const pdfUrl: string | undefined = qontoInvoice?.invoice_url;
    const rawStatus: string | undefined = qontoInvoice?.status;

    if (!qontoInvoiceId) {
      return json({ error: 'Qonto /client_invoices a répondu sans id de facture exploitable', raw: invoiceData }, 502);
    }

    // Statut RÉEL renvoyé par Qonto (confirmé : 'unpaid' pour une facture
    // fraîchement finalisée, 'draft' pour une facture non finalisée) —
    // stocké tel quel plutôt que remappé dans un enum imaginé au préalable.
    const transmissionStatus = rawStatus || 'pending';

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

    // Facture d'avance : envoyée au membre par nos soins (jamais bloquant —
    // la facture est émise ; l'email se renvoie depuis la fiche mission).
    const emailError = isAdvance
      ? await emailAdvanceInvoice(qontoInvoiceId, invoiceRow.profile_id, invoiceRow.sourcing_mission_id)
      : null;

    return json({
      success: true,
      already_emitted: false,
      email_sent: isAdvance && !emailError,
      email_error: emailError,
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
