// Edge Function : sav-detect-action
//
// Détection par l'IA des propositions de remboursement dans un ticket SAV (0271).
//
//   mode 'team'   : appelé par l'admin juste après l'envoi d'une réponse au
//                   client. Si la réponse propose d'annuler / rembourser une
//                   commande, le message devient une question Oui / Non
//                   (sav_ticket_messages.action) et le ticket porte la
//                   proposition (sav_tickets.pending_action, state 'proposed').
//   mode 'client' : appelé par « Mes demandes » après un message écrit du
//                   client. Si une proposition est en attente et que le client
//                   l'accepte ou la refuse par écrit, pending_action passe à
//                   'accepted' / 'declined' (source 'ai').
//
// L'IA ne déclenche jamais de remboursement : « accepted » affiche seulement à
// l'équipe le bouton « Annuler et rembourser » (fiche ticket).
//
// Body : { ticket_id, mode }. Équipe (hasAdminAccess) pour 'team', auteur de la
// demande pour 'client'.
// Déploiement : `supabase functions deploy sav-detect-action`
// Secrets : ANTHROPIC_API_KEY, SAV_DETECT_MODEL (facultatif)

import { createClient } from 'npm:@supabase/supabase-js@2';
import Anthropic from 'npm:@anthropic-ai/sdk@0';
import { hasAdminAccess } from '../_shared/adminAccess.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const MODEL = Deno.env.get('SAV_DETECT_MODEL') || 'claude-haiku-5-5';

type OrderRow = {
  id: string;
  order_number: string;
  created_at: string;
  payment_status: string;
  order_items: { id: string; status: string; line_total: number; insured: boolean; insurance_cost: number; product_snapshot: { name?: string } | null }[];
};

const TEAM_TOOL = {
  name: 'classer_message',
  description: "Classe le message de l'équipe OZË envoyé au client.",
  input_schema: {
    type: 'object' as const,
    properties: {
      propose_remboursement: {
        type: 'boolean',
        description:
          "true si le message PROPOSE au client d'annuler et/ou rembourser une commande ou des articles (remboursement carte, avoir / crédit portefeuille), en attendant son accord. false pour une simple information, une demande de précisions, un remboursement déjà effectué ou un refus.",
      },
      order_number: { type: 'string', description: 'Numéro de la commande concernée, parmi les commandes listées (vide si inconnu).' },
      item_ids: {
        type: 'array',
        items: { type: 'string' },
        description: "Identifiants des articles concernés si le remboursement ne porte que sur certains articles ; vide = toute la commande.",
      },
    },
    required: ['propose_remboursement'],
  },
};

const CLIENT_TOOL = {
  name: 'classer_reponse',
  description: 'Classe la réponse du client à la proposition de remboursement.',
  input_schema: {
    type: 'object' as const,
    properties: {
      decision: {
        type: 'string',
        enum: ['accepte', 'refuse', 'indetermine'],
        description:
          "accepte : le client accepte clairement l'annulation / le remboursement proposé. refuse : il le refuse ou préfère autre chose (échange, garder l'article…). indetermine : il pose une question, hésite, ou parle d'autre chose.",
      },
      citation: { type: 'string', description: 'Courte citation du client qui justifie la décision.' },
    },
    required: ['decision'],
  },
};

const ask = async (anthropic: Anthropic, tool: typeof TEAM_TOOL | typeof CLIENT_TOOL, prompt: string) => {
  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 400,
    tools: [tool],
    tool_choice: { type: 'tool', name: tool.name },
    messages: [{ role: 'user', content: prompt }],
  });
  const block = res.content.find((b) => b.type === 'tool_use') as { input: Record<string, unknown> } | undefined;
  return block?.input ?? {};
};

const describeOrder = (o: OrderRow) =>
  `Commande ${o.order_number} du ${o.created_at.slice(0, 10)} (paiement ${o.payment_status}) :\n` +
  o.order_items
    .filter((i) => i.status === 'active')
    .map((i) => `  - [${i.id}] ${i.product_snapshot?.name || 'Article'} : ${Number(i.line_total) + (i.insured ? Number(i.insurance_cost) : 0)} €`)
    .join('\n');

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

    const { ticket_id, mode } = await req.json();
    if (!ticket_id || (mode !== 'team' && mode !== 'client')) return json({ error: 'ticket_id et mode requis' }, 400);

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data: t } = await admin
      .from('sav_tickets')
      .select('id, reseller_id, created_by_profile_id, order_id, status, pending_action')
      .eq('id', ticket_id)
      .maybeSingle();
    if (!t) return json({ error: 'Ticket introuvable' }, 404);

    if (mode === 'team') {
      if (!(await hasAdminAccess(caller, user.id))) return json({ error: "Réservé à l'équipe" }, 403);
    } else if (t.created_by_profile_id !== user.id) {
      return json({ error: 'Demande introuvable' }, 404);
    }

    const anthropic = new Anthropic({ apiKey });
    const { data: msgs } = await admin
      .from('sav_ticket_messages')
      .select('id, author_type, internal, content, created_at, yes_no, yes_no_answer, action')
      .eq('ticket_id', ticket_id)
      .eq('internal', false)
      .neq('author_type', 'system')
      .order('created_at');
    const thread = (msgs || []) as { id: string; author_type: string; content: string; created_at: string; yes_no: boolean; yes_no_answer: string | null; action: unknown }[];

    // ── Réponse de l'équipe : est-ce une proposition de remboursement ? ──
    if (mode === 'team') {
      const last = [...thread].reverse().find((m) => m.author_type === 'team');
      if (!last || last.action || last.yes_no_answer) return json({ action: null });

      // Commandes candidates : la commande liée + les dernières de la personne.
      const fields = 'id, order_number, created_at, payment_status, order_items(id, status, line_total, insured, insurance_cost, product_snapshot)';
      const [linked, recent] = await Promise.all([
        t.order_id ? admin.from('orders').select(fields).eq('id', t.order_id).maybeSingle() : Promise.resolve({ data: null }),
        t.created_by_profile_id
          ? admin
              .from('orders')
              .select(fields)
              .eq('reseller_id', t.reseller_id)
              .eq('placed_by_profile_id', t.created_by_profile_id)
              .neq('status', 'cancelled')
              .order('created_at', { ascending: false })
              .limit(8)
          : Promise.resolve({ data: [] }),
      ]);
      const orders: OrderRow[] = [];
      for (const o of [linked.data, ...((recent.data as OrderRow[] | null) || [])] as (OrderRow | null)[]) {
        if (o && !orders.some((x) => x.id === o.id) && o.order_items.some((i) => i.status === 'active')) orders.push(o);
      }
      if (orders.length === 0) return json({ action: null });

      const history = thread
        .slice(-8, -1)
        .map((m) => `${m.author_type === 'team' ? 'Équipe' : 'Client'} : ${m.content}`)
        .join('\n');
      const input = await ask(
        anthropic,
        TEAM_TOOL,
        `Service client d'OZË Paris (revente de maroquinerie de luxe aux revendeurs).\n\n# Commandes du client${t.order_id ? ' (la première est celle liée à la demande)' : ''}\n${orders.map(describeOrder).join('\n')}\n\n# Échange précédent\n${history || '(aucun)'}\n\n# Message de l'équipe à classer\n${last.content}`
      );
      if (input.propose_remboursement !== true) return json({ action: null });

      const order = orders.find((o) => o.order_number === input.order_number) || (t.order_id ? orders[0] : orders.length === 1 ? orders[0] : null);
      if (!order) return json({ action: null });
      const active = order.order_items.filter((i) => i.status === 'active');
      const picked = Array.isArray(input.item_ids) ? active.filter((i) => (input.item_ids as string[]).includes(i.id)) : [];
      const items = picked.length ? picked : active;
      const amount = Math.round(items.reduce((s, i) => s + Number(i.line_total) + (i.insured ? Number(i.insurance_cost) : 0), 0) * 100) / 100;

      const action = {
        type: 'refund',
        order_id: order.id,
        order_number: order.order_number,
        order_item_ids: picked.length && picked.length < active.length ? picked.map((i) => i.id) : [],
        amount,
      };
      await admin.from('sav_ticket_messages').update({ action, yes_no: true }).eq('id', last.id);
      await admin
        .from('sav_tickets')
        .update({
          pending_action: { ...action, message_id: last.id, state: 'proposed', proposed_at: new Date().toISOString() },
          status: t.status === 'closed' ? t.status : 'waiting_client',
        })
        .eq('id', ticket_id);
      return json({ action });
    }

    // ── Message écrit du client : accepte-t-il la proposition en attente ? ──
    const pending = t.pending_action as Record<string, unknown> | null;
    if (!pending || pending.state !== 'proposed') return json({ decision: null });
    const proposalIdx = thread.findIndex((m) => m.id === pending.message_id);
    if (proposalIdx < 0) return json({ decision: null });
    const proposal = thread[proposalIdx];
    const replies = thread.slice(proposalIdx + 1).filter((m) => m.author_type === 'client');
    if (replies.length === 0) return json({ decision: null });

    const input = await ask(
      anthropic,
      CLIENT_TOOL,
      `Service client d'OZË Paris. L'équipe a proposé au client d'annuler et rembourser la commande ${pending.order_number} (${pending.amount} €).\n\n# Proposition de l'équipe\n${proposal.content}\n\n# Réponse(s) écrite(s) du client depuis\n${replies.map((m) => m.content).join('\n---\n')}`
    );
    const decision = input.decision === 'accepte' ? 'accepted' : input.decision === 'refuse' ? 'declined' : null;
    if (!decision) return json({ decision: null });

    await admin
      .from('sav_tickets')
      .update({
        pending_action: {
          ...pending,
          state: decision,
          source: 'ai',
          quote: typeof input.citation === 'string' ? input.citation.slice(0, 300) : null,
          answered_at: new Date().toISOString(),
        },
      })
      .eq('id', ticket_id)
      .eq('pending_action->>state', 'proposed');
    // La question est réglée : plus de boutons Oui / Non côté client.
    if (!proposal.yes_no_answer) {
      await admin.from('sav_ticket_messages').update({ yes_no_answer: decision === 'accepted' ? 'yes' : 'no' }).eq('id', proposal.id);
    }
    return json({ decision });
  } catch (e) {
    console.error('sav-detect-action', e);
    return json({ error: e instanceof Error ? e.message : 'Erreur' }, 500);
  }
});
