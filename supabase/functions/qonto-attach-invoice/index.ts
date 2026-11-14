// Edge Function : qonto-attach-invoice
//
// Comptabilité → Trésorerie Qonto → « Encaissements sans justificatif » :
// dépose la facture d'un encaissement client sur sa transaction Qonto.
//   - facture émise sur Qonto (qonto_invoice_id) : son PDF officiel est relu
//     chez Qonto (client_invoices → attachment) puis déposé ;
//   - facture de l'admin seulement : PDF généré par l'admin (modèle
//     generateInvoicePdf) et envoyé dans le body (data_base64).
// Puis relit la transaction (attachment_ids, raw) dans bank_transactions.
//
// Réservé au propriétaire. Body : { bank_transaction_id, invoice_id, filename?, data_base64? }.
// Déploiement : `supabase functions deploy qonto-attach-invoice`
// Secrets : QONTO_SECRET_KEY, QONTO_ORGANIZATION_SLUG

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const QONTO_BASE_URL = 'https://thirdparty.qonto.com/v2';
const MAX_BYTES = 15 * 1024 * 1024;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const secretKey = Deno.env.get('QONTO_SECRET_KEY');
    const orgSlug = Deno.env.get('QONTO_ORGANIZATION_SLUG');
    if (!secretKey || !orgSlug) return json({ error: 'Identifiants Qonto manquants côté serveur' }, 500);

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Non authentifié' }, 401);
    const caller = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await caller.auth.getUser();
    if (!user) return json({ error: 'Non authentifié' }, 401);
    const admin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: profile } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle();
    if (profile?.role !== 'admin') return json({ error: 'Réservé au propriétaire' }, 403);

    const { bank_transaction_id, invoice_id, filename, data_base64 } = await req.json();
    if (!bank_transaction_id || !invoice_id) return json({ error: 'bank_transaction_id et invoice_id requis' }, 400);

    const [{ data: bank }, { data: invoice }] = await Promise.all([
      admin.from('bank_transactions').select('id, raw').eq('id', bank_transaction_id).maybeSingle(),
      admin.from('invoices').select('id, invoice_number, qonto_invoice_id, qonto_invoice_number').eq('id', invoice_id).maybeSingle(),
    ]);
    const qontoTxId = (bank?.raw as { id?: string } | null)?.id;
    if (!bank || !qontoTxId) return json({ error: 'Transaction Qonto introuvable' }, 404);
    if (!invoice) return json({ error: 'Facture introuvable' }, 404);

    const qontoAuth = { Authorization: `${orgSlug}:${secretKey}` };
    let bytes: Uint8Array;
    let name = String(filename || `Facture_${invoice.qonto_invoice_number || invoice.invoice_number}.pdf`).slice(0, 120);

    if (invoice.qonto_invoice_id) {
      // PDF officiel de la facture émise sur Qonto.
      const invRes = await fetch(`${QONTO_BASE_URL}/client_invoices/${invoice.qonto_invoice_id}`, { headers: qontoAuth });
      if (!invRes.ok) return json({ error: `Qonto : facture illisible (${invRes.status})` }, 502);
      const attachmentId = (await invRes.json())?.client_invoice?.attachment_id;
      if (!attachmentId) return json({ error: 'Qonto ne fournit pas encore le PDF de cette facture' }, 502);
      const attRes = await fetch(`${QONTO_BASE_URL}/attachments/${attachmentId}`, { headers: qontoAuth });
      if (!attRes.ok) return json({ error: `Qonto : PDF illisible (${attRes.status})` }, 502);
      const att = (await attRes.json())?.attachment;
      const pdfRes = await fetch(att?.url);
      if (!pdfRes.ok) return json({ error: 'Téléchargement du PDF Qonto impossible' }, 502);
      bytes = new Uint8Array(await pdfRes.arrayBuffer());
      if (att?.file_name) name = String(att.file_name).slice(0, 120);
    } else {
      if (!data_base64) return json({ error: 'PDF de la facture requis (facture non émise sur Qonto)' }, 400);
      bytes = Uint8Array.from(atob(String(data_base64)), (c) => c.charCodeAt(0));
    }
    if (bytes.byteLength > MAX_BYTES) return json({ error: 'Fichier trop lourd (15 Mo maximum)' }, 400);

    const form = new FormData();
    form.append('file', new Blob([bytes], { type: 'application/pdf' }), name);
    const upload = await fetch(`${QONTO_BASE_URL}/transactions/${qontoTxId}/attachments`, {
      method: 'POST',
      headers: { ...qontoAuth, 'X-Qonto-Idempotency-Key': crypto.randomUUID() },
      body: form,
    });
    if (!upload.ok) {
      const body = await upload.text();
      console.error('qonto-attach-invoice', upload.status, body);
      return json({ error: `Qonto a refusé le justificatif (${upload.status}) : ${body.slice(0, 300)}` }, 502);
    }

    const res = await fetch(`${QONTO_BASE_URL}/transactions/${qontoTxId}`, { headers: qontoAuth });
    if (res.ok) {
      const tx = (await res.json())?.transaction;
      if (tx) {
        await admin
          .from('bank_transactions')
          .update({ attachment_ids: tx.attachment_ids || [], raw: tx, updated_at: new Date().toISOString() })
          .eq('id', bank.id);
      }
    }
    return json({ success: true, invoice_number: invoice.qonto_invoice_number || invoice.invoice_number });
  } catch (e) {
    console.error('qonto-attach-invoice', e);
    return json({ error: e instanceof Error ? e.message : 'Erreur' }, 500);
  }
});
