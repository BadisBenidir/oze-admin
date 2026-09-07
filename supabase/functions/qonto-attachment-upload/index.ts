// Edge Function : qonto-attachment-upload
//
// Attache un justificatif (PDF/photo de reçu) à une transaction Qonto
// directement depuis le back-office, via l'API Qonto (jamais de clé secrète
// côté client — même principe que qonto-sync). Réservé aux admins,
// contrairement à qonto-sync (voir vérification de rôle ci-dessous, même
// schéma que sendcloud-download-label).
//
// ⚠️ Implémenté au meilleur de la documentation publique Qonto API v2 —
// sans compte Qonto réel pour tester : l'endpoint exact d'upload
// (`POST /v2/transactions/{id}/attachments`, multipart) est celui documenté
// publiquement au moment de l'écriture. À vérifier/ajuster au premier essai
// réel si Qonto a fait évoluer ce contrat depuis.
// Déploiement : `supabase functions deploy qonto-attachment-upload`

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const QONTO_BASE_URL = 'https://thirdparty.qonto.com/v2';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Non authentifié' }, 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const callerClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: userError } = await callerClient.auth.getUser();
    if (userError || !user) return json({ error: 'Non authentifié' }, 401);

    const { data: callerProfile } = await callerClient.from('profiles').select('role').eq('id', user.id).maybeSingle();
    if (callerProfile?.role !== 'admin') {
      return json({ error: 'Accès refusé : réservé aux administrateurs' }, 403);
    }

    const secretKey = Deno.env.get('QONTO_SECRET_KEY');
    const orgSlug = Deno.env.get('QONTO_ORGANIZATION_SLUG');
    if (!secretKey || !orgSlug) {
      return json({ error: 'QONTO_SECRET_KEY / QONTO_ORGANIZATION_SLUG manquants dans les secrets Supabase' }, 500);
    }

    const formData = await req.formData();
    const bankTransactionId = formData.get('bank_transaction_id');
    const file = formData.get('file');
    if (typeof bankTransactionId !== 'string' || !bankTransactionId) {
      return json({ error: 'bank_transaction_id est requis' }, 400);
    }
    if (!(file instanceof File)) {
      return json({ error: 'Fichier manquant' }, 400);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: bankTx, error: bankTxError } = await adminClient
      .from('bank_transactions')
      .select('id, qonto_transaction_id')
      .eq('id', bankTransactionId)
      .single();
    if (bankTxError || !bankTx) return json({ error: 'Transaction bancaire introuvable' }, 404);

    const qontoForm = new FormData();
    qontoForm.append('file', file, file.name);

    const uploadRes = await fetch(`${QONTO_BASE_URL}/transactions/${bankTx.qonto_transaction_id}/attachments`, {
      method: 'POST',
      headers: { Authorization: `${orgSlug}:${secretKey}` },
      body: qontoForm,
    });

    if (!uploadRes.ok) {
      const body = await uploadRes.text();
      return json({ error: `Envoi à Qonto échoué (${uploadRes.status}) : ${body}` }, 502);
    }

    // Qonto ne renvoie pas toujours le détail de la pièce jointe dans la
    // réponse d'upload — on relit la transaction pour récupérer la liste
    // d'attachment_ids à jour plutôt que de la reconstruire à la main.
    const txRes = await fetch(`${QONTO_BASE_URL}/transactions/${bankTx.qonto_transaction_id}`, {
      headers: { Authorization: `${orgSlug}:${secretKey}` },
    });
    const attachmentIds: string[] = txRes.ok ? (await txRes.json())?.transaction?.attachment_ids || [] : [];

    await adminClient
      .from('bank_transactions')
      .update({ attachment_ids: attachmentIds, updated_at: new Date().toISOString() })
      .eq('id', bankTx.id);

    return json({ success: true, attachment_ids: attachmentIds });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Erreur inconnue' }, 500);
  }
});
