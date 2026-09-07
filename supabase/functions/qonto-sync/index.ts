// Edge Function : qonto-sync
//
// Synchronise le solde et les transactions du compte Qonto d'OZË Paris dans
// bank_account_snapshot / bank_transactions (0114_qonto_bank_transactions.sql).
// La clé secrète Qonto ne quitte JAMAIS le serveur — même principe que
// STRIPE_SECRET_KEY dans wallet-topup/b2b-checkout : jamais lue depuis le
// corps de la requête, uniquement depuis les secrets Supabase.
//
// Deux modes d'appel, comme fetch-jpy-eur-rate : planifié via pg_cron
// (net.http_post, aucun JWT — la synchro elle-même n'expose aucune donnée
// sensible en retour, juste des compteurs) et manuel depuis le dashboard
// admin (bouton "Rafraîchir les données bancaires").
//
// ⚠️ Implémenté au meilleur de la documentation publique Qonto API v2 au
// moment de l'écriture (thirdparty.qonto.com) — sans accès à un compte
// Qonto réel pour tester en conditions live. Vérifier les noms de champs
// exacts de la réponse (`response.transactions[]`, `bank_account.balance`,
// pagination `meta.next_page`) lors du premier sync réel et ajuster si
// Qonto a fait évoluer son contrat depuis.
// Déploiement : `supabase functions deploy qonto-sync`

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const QONTO_BASE_URL = 'https://thirdparty.qonto.com/v2';

interface QontoTransaction {
  transaction_id: string;
  status: string;
  side: 'debit' | 'credit';
  operation_type: string;
  amount: number;
  currency: string;
  label: string;
  emitted_at: string | null;
  settled_at: string | null;
  attachment_ids: string[];
  vat_amount?: number;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const secretKey = Deno.env.get('QONTO_SECRET_KEY');
    const orgSlug = Deno.env.get('QONTO_ORG_SLUG');
    const targetIban = Deno.env.get('QONTO_IBAN');

    if (!secretKey || !orgSlug) {
      console.error('qonto-sync: QONTO_SECRET_KEY / QONTO_ORG_SLUG manquants');
      return json({ error: 'QONTO_SECRET_KEY / QONTO_ORG_SLUG manquants dans les secrets Supabase' }, 500);
    }

    const qontoHeaders = {
      Authorization: `${orgSlug}:${secretKey}`,
      'Content-Type': 'application/json',
    };

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // 1. Solde live — /v2/organizations/{slug} renvoie tous les comptes
    // bancaires de l'organisation ; on cible celui dont l'IBAN correspond à
    // QONTO_IBAN si plusieurs comptes existent, sinon le premier.
    console.log(`qonto-sync: appel /organizations/${orgSlug}`);
    const orgRes = await fetch(`${QONTO_BASE_URL}/organizations/${orgSlug}`, { headers: qontoHeaders });
    if (!orgRes.ok) {
      const body = await orgRes.text();
      console.error(`qonto-sync: /organizations a échoué (${orgRes.status})`, body);
      throw new Error(`Qonto /organizations a échoué (${orgRes.status}) : ${body}`);
    }
    const orgData = await orgRes.json();
    const bankAccounts = orgData?.organization?.bank_accounts || [];
    const account = (targetIban && bankAccounts.find((a: { iban?: string }) => a.iban === targetIban)) || bankAccounts[0];

    if (!account) {
      console.error('qonto-sync: aucun compte bancaire trouvé', JSON.stringify(orgData));
      throw new Error('Aucun compte bancaire Qonto trouvé pour cette organisation');
    }
    console.log(`qonto-sync: compte trouvé (iban=${account.iban}), solde=${account.balance}`);

    await adminClient.from('bank_account_snapshot').upsert({
      id: 'main',
      balance: account.balance,
      currency: account.currency || 'EUR',
      iban: account.iban,
      fetched_at: new Date().toISOString(),
    });

    // 2. Transactions — paginé, plafonné pour ne jamais tourner
    // indéfiniment sur un très gros historique (voir consigne "cache" :
    // seules les nouvelles transactions doivent être re-synchronisées à
    // chaque appel une fois l'historique initial rapatrié).
    const MAX_PAGES = 20;
    let page = 1;
    let totalSynced = 0;
    const allTransactions: QontoTransaction[] = [];

    while (page <= MAX_PAGES) {
      const url = new URL(`${QONTO_BASE_URL}/transactions`);
      url.searchParams.set('iban', account.iban);
      url.searchParams.set('sort_by', 'settled_at:desc');
      url.searchParams.set('per_page', '100');
      url.searchParams.set('current_page', String(page));

      const txRes = await fetch(url.toString(), { headers: qontoHeaders });
      if (!txRes.ok) {
        const body = await txRes.text();
        console.error(`qonto-sync: /transactions a échoué (${txRes.status})`, body);
        throw new Error(`Qonto /transactions a échoué (${txRes.status}) : ${body}`);
      }
      const txData = await txRes.json();
      const transactions: QontoTransaction[] = txData?.transactions || [];
      allTransactions.push(...transactions);

      const hasNextPage = Boolean(txData?.meta?.next_page);
      if (!hasNextPage || transactions.length === 0) break;
      page += 1;
    }

    for (const tx of allTransactions) {
      const { error: upsertError } = await adminClient.from('bank_transactions').upsert(
        {
          qonto_transaction_id: tx.transaction_id,
          qonto_status: tx.status,
          side: tx.side,
          operation_type: tx.operation_type,
          amount: tx.amount,
          currency: tx.currency || 'EUR',
          label: tx.label,
          emitted_at: tx.emitted_at,
          settled_at: tx.settled_at,
          attachment_ids: tx.attachment_ids || [],
          raw: tx,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'qonto_transaction_id', ignoreDuplicates: false }
      );
      if (!upsertError) totalSynced += 1;
    }

    // 3. Rapprochement automatique — uniquement sur les transactions encore
    // non rapprochées, jamais sur celles déjà traitées manuellement (ne pas
    // écraser un rapprochement/ignore fait par un admin).
    const { data: unmatched } = await adminClient
      .from('bank_transactions')
      .select('id, label, side, amount, settled_at')
      .eq('reconciliation_status', 'unmatched')
      .is('matched_type', null);

    let totalMatched = 0;
    for (const row of unmatched || []) {
      const labelUpper = (row.label || '').toUpperCase();

      // Règle 1 : libellé Stripe -> reversement groupé des ventes B2C/B2B,
      // jamais rattachable à UNE commande précise (versement en lot) —
      // simple étiquette informative plutôt qu'un vrai rapprochement.
      if (labelUpper.includes('STRIPE')) {
        await adminClient
          .from('bank_transactions')
          .update({ matched_type: 'stripe_payout', note: 'Reversement Stripe (ventes groupées)' })
          .eq('id', row.id);
        totalMatched += 1;
        continue;
      }

      // Règle 2 : virement entrant dont le montant correspond exactement à
      // une avance de sourcing sur mesure encore non rapprochée, payée par
      // virement, dans les 7 jours autour du règlement bancaire.
      if (row.side === 'credit' && row.settled_at) {
        const settledDate = new Date(row.settled_at);
        const windowStart = new Date(settledDate);
        windowStart.setDate(windowStart.getDate() - 7);
        const windowEnd = new Date(settledDate);
        windowEnd.setDate(windowEnd.getDate() + 7);

        const { data: missionMatch } = await adminClient
          .from('b2b_sourcing_missions')
          .select('id, advance_amount, payment_method, paid_at')
          .eq('advance_amount', row.amount)
          .ilike('payment_method', '%virement%')
          .gte('paid_at', windowStart.toISOString())
          .lte('paid_at', windowEnd.toISOString())
          .limit(1)
          .maybeSingle();

        if (missionMatch) {
          // Une mission ne doit être suggérée que si aucune autre
          // transaction ne la référence déjà (évite un doublon si deux
          // avances ont exactement le même montant).
          const { data: alreadyLinked } = await adminClient
            .from('bank_transactions')
            .select('id')
            .eq('matched_sourcing_mission_id', missionMatch.id)
            .maybeSingle();

          if (!alreadyLinked) {
            await adminClient
              .from('bank_transactions')
              .update({
                matched_type: 'sourcing_mission',
                matched_sourcing_mission_id: missionMatch.id,
                reconciliation_status: 'matched',
                note: 'Avance de sourcing sur mesure (montant + date correspondants) — à confirmer',
              })
              .eq('id', row.id);
            totalMatched += 1;
          }
        }
      }
    }

    return json({
      success: true,
      balance: account.balance,
      transactions_synced: totalSynced,
      auto_matched: totalMatched,
    });
  } catch (err) {
    console.error('qonto-sync: erreur non gérée', err instanceof Error ? err.stack || err.message : err);
    return json({ error: err instanceof Error ? err.message : 'Erreur inconnue' }, 500);
  }
});
