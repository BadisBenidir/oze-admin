// Edge Function : qonto-upload-attachment
//
// Comptabilité → Charges : dépose un justificatif (facture, ticket) sur la
// transaction Qonto reliée à une charge (expenses.bank_transaction_id), puis
// relit la transaction pour mettre à jour bank_transactions (attachment_ids,
// raw — dont la TVA lue par Qonto, 0280).
//
// Réservé au propriétaire (comme la table expenses).
// Body : { expense_id, filename, content_type, data_base64 } (PDF, JPEG, PNG).
// Déploiement : `supabase functions deploy qonto-upload-attachment`
// Secrets : QONTO_SECRET_KEY, QONTO_ORGANIZATION_SLUG

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const QONTO_BASE_URL = 'https://thirdparty.qonto.com/v2';
const ALLOWED = ['application/pdf', 'image/jpeg', 'image/png'];
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

    const { expense_id, filename, content_type, data_base64 } = await req.json();
    if (!expense_id || !data_base64) return json({ error: 'expense_id et fichier requis' }, 400);
    const type = String(content_type || '').toLowerCase();
    if (!ALLOWED.includes(type)) return json({ error: 'Format accepté par Qonto : PDF, JPEG ou PNG' }, 400);
    const bytes = Uint8Array.from(atob(String(data_base64)), (c) => c.charCodeAt(0));
    if (bytes.byteLength > MAX_BYTES) return json({ error: 'Fichier trop lourd (15 Mo maximum)' }, 400);

    const { data: expense } = await admin
      .from('expenses')
      .select('id, bank_transaction_id, bank:bank_transactions!expenses_bank_transaction_id_fkey(id, raw)')
      .eq('id', expense_id)
      .maybeSingle();
    const bank = expense?.bank as unknown as { id: string; raw: { id?: string } | null } | null;
    const qontoId = bank?.raw?.id;
    if (!bank || !qontoId) return json({ error: 'Cette charge n\'est reliée à aucune transaction Qonto' }, 400);

    const qontoAuth = { Authorization: `${orgSlug}:${secretKey}` };
    const form = new FormData();
    form.append('file', new Blob([bytes], { type }), String(filename || 'justificatif').slice(0, 120));
    const upload = await fetch(`${QONTO_BASE_URL}/transactions/${qontoId}/attachments`, {
      method: 'POST',
      headers: { ...qontoAuth, 'X-Qonto-Idempotency-Key': crypto.randomUUID() },
      body: form,
    });
    if (!upload.ok) {
      const body = await upload.text();
      console.error('qonto-upload-attachment', upload.status, body);
      return json({ error: `Qonto a refusé le justificatif (${upload.status}) : ${body.slice(0, 300)}` }, 502);
    }

    // Relit la transaction : pièces jointes (et TVA si Qonto l'a déjà lue).
    const res = await fetch(`${QONTO_BASE_URL}/transactions/${qontoId}`, { headers: qontoAuth });
    if (res.ok) {
      const tx = (await res.json())?.transaction;
      if (tx) {
        await admin
          .from('bank_transactions')
          .update({ attachment_ids: tx.attachment_ids || [], raw: tx, updated_at: new Date().toISOString() })
          .eq('id', bank.id);
      }
    }
    return json({ success: true });
  } catch (e) {
    console.error('qonto-upload-attachment', e);
    return json({ error: e instanceof Error ? e.message : 'Erreur' }, 500);
  }
});
