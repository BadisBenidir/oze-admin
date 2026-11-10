// Edge Function : sav-suggest-reply
//
// Bouton « Suggérer une réponse » de la fiche ticket (admin SAV, 0263) :
// Claude rédige un BROUILLON de réponse au client à partir du fil, des notes
// internes, de la commande liée et de la base de connaissances. Le brouillon
// est renvoyé à l'admin, qui le relit et le modifie : rien n'est jamais
// envoyé automatiquement.
//
// Réservé à l'équipe (hasAdminAccess). Body : { ticket_id }.
// Déploiement : `supabase functions deploy sav-suggest-reply`
// Secrets : ANTHROPIC_API_KEY, SAV_CHAT_MODEL (facultatif)

import { createClient } from 'npm:@supabase/supabase-js@2';
import Anthropic from 'npm:@anthropic-ai/sdk@0';
import { hasAdminAccess } from '../_shared/adminAccess.ts';
import { FULFILLMENT_LABELS, SAV_CATEGORIES, loadKnowledgeBase } from '../_shared/savKnowledge.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const MODEL = Deno.env.get('SAV_CHAT_MODEL') || 'claude-sonnet-5-5';

const RULES = `Tu rédiges, pour l'équipe du service client d'OZË Paris (maroquinerie de luxe de seconde main achetée au Japon, vendue aux revendeurs du Club B2B), un BROUILLON de réponse au client. Un membre de l'équipe le relira et le modifiera avant envoi.

- Français, vouvoiement, ton professionnel et chaleureux, concis (3 à 8 phrases).
- Commence par « Bonjour <prénom>, » si le prénom est connu, sinon « Bonjour, ». Termine par « Belle journée,\\nL'équipe OZË Paris ».
- Appuie-toi uniquement sur la base de connaissances, le fil, les notes internes et les données de commande fournies. N'invente aucun délai, montant, remboursement ni geste commercial.
- Si les notes internes indiquent une décision, reflète-la. Sinon, ne promets aucune issue : indique ce qui est vérifié ou demande l'information manquante (photos, précisions).
- Les notes internes sont confidentielles : ne les cite jamais telles quelles au client.
- Réponds UNIQUEMENT par le texte du message, sans commentaire autour.`;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) return json({ error: 'ANTHROPIC_API_KEY non configurée' }, 503);

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Non authentifié' }, 401);
    const caller = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await caller.auth.getUser();
    if (!user) return json({ error: 'Non authentifié' }, 401);
    if (!(await hasAdminAccess(caller, user.id))) return json({ error: 'Réservé à l\'équipe' }, 403);

    const { ticket_id } = await req.json();
    if (!ticket_id) return json({ error: 'ticket_id requis' }, 400);

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data: t } = await admin
      .from('sav_tickets')
      .select('id, number, category, subject, status, order_id, ai_summary, is_dispute, dispute_decision, dispute_reason, creator:profiles!sav_tickets_created_by_profile_id_fkey(first_name)')
      .eq('id', ticket_id)
      .maybeSingle();
    if (!t) return json({ error: 'Ticket introuvable' }, 404);

    const [{ data: msgs }, knowledge, orderRes] = await Promise.all([
      admin.from('sav_ticket_messages').select('author_type, internal, content, attachments, created_at').eq('ticket_id', ticket_id).order('created_at'),
      loadKnowledgeBase(admin),
      t.order_id
        ? admin
            .from('orders')
            .select('order_number, created_at, payment_status, total_amount, order_items(product_snapshot, unit_price, status, fulfillment_status, shipped_at, delivered_at)')
            .eq('id', t.order_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    const thread = (msgs || [])
      .map((m: { author_type: string; internal: boolean; content: string; attachments: unknown[]; created_at: string }) => {
        const who = m.internal ? 'NOTE INTERNE (équipe)' : m.author_type === 'team' ? 'Équipe OZË' : m.author_type === 'system' ? "Résumé de l'assistant" : 'Client';
        const photos = Array.isArray(m.attachments) && m.attachments.length ? ` [${m.attachments.length} pièce(s) jointe(s)]` : '';
        return `[${m.created_at.slice(0, 16).replace('T', ' ')}] ${who} :\n${m.content}${photos}`;
      })
      .join('\n\n');

    const o = orderRes.data as Record<string, unknown> | null;
    const order = o
      ? `Commande ${o.order_number} du ${String(o.created_at).slice(0, 10)}, paiement ${o.payment_status}, total ${o.total_amount} €.\n` +
        ((o.order_items as Record<string, unknown>[]) || [])
          .map((i) => `- ${(i.product_snapshot as { name?: string })?.name || 'Article'} : ${i.unit_price} €, ${i.status === 'cancelled' ? 'annulé' : FULFILLMENT_LABELS[String(i.fulfillment_status)] || i.fulfillment_status}`)
          .join('\n')
      : 'Aucune commande liée.';

    const creator = t.creator as { first_name?: string } | null;
    const context = `Ticket ${t.number} — ${SAV_CATEGORIES[t.category] || t.category} — « ${t.subject} » — statut ${t.status}.
Prénom du client : ${creator?.first_name || 'inconnu'}.
${t.is_dispute ? `Litige : décision ${t.dispute_decision || 'pas encore prise'}${t.dispute_reason ? `, motif : ${t.dispute_reason}` : ''}.` : ''}

# Commande
${order}

# Fil du ticket
${thread || '(vide)'}`;

    const anthropic = new Anthropic({ apiKey });
    const res = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 800,
      system: `${RULES}\n\n# Base de connaissances OZË\n${knowledge || '(vide)'}`,
      messages: [{ role: 'user', content: `${context}\n\nRédige le brouillon de la prochaine réponse de l'équipe au client.` }],
    });
    const draft = res.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { text: string }).text)
      .join('')
      .trim();
    return json({ draft });
  } catch (e) {
    console.error('sav-suggest-reply', e);
    return json({ error: e instanceof Error ? e.message : 'Erreur' }, 500);
  }
});
