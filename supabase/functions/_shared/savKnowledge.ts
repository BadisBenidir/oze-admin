// SAV OZË (0263) : base de connaissances du chatbot, éditée dans l'admin
// (SAV → Base de connaissances, table sav_knowledge_base). Partagée entre
// sav-chat (réponses aux revendeurs) et sav-suggest-reply (brouillons équipe).

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export const SAV_CATEGORIES: Record<string, string> = {
  order_delivery: 'Commande / livraison',
  parcel_damaged_lost: 'Colis endommagé ou perdu',
  authenticity: 'Authenticité',
  return_refund: 'Retour / remboursement',
  payment: 'Paiement',
  subscription: 'Abonnement Club B2B',
  sourcing: 'Sourcing sur mesure',
  other: 'Autre',
};

export const FULFILLMENT_LABELS: Record<string, string> = {
  ordered: 'Commandé (acheté au Japon, en cours d\'acheminement vers la France)',
  received: 'Reçu chez OZË (en France)',
  ready_to_ship: 'Prêt à expédier (en attente d\'une demande de livraison du client)',
  delivery_requested: 'Livraison demandée',
  label_created: 'En préparation (étiquette créée)',
  shipped: 'Expédié / en transit',
  delivered: 'Livré',
};

/**
 * Base de connaissances pour le prompt : rubriques, réponses types (à
 * reprendre telles quelles) et consignes de comportement ([BOT], 0267) —
 * ces dernières sont des instructions pour le modèle, jamais du texte à
 * montrer au client.
 */
export async function loadKnowledgeBase(admin: SupabaseClient): Promise<string> {
  const { data } = await admin
    .from('sav_knowledge_base')
    .select('category, title, content, bot_notes')
    .eq('active', true)
    .order('position');
  const rows = (data || []) as { category: string; title: string; content: string; bot_notes: string }[];
  const out: string[] = [];
  let current = '';
  for (const e of rows) {
    if (!e.content?.trim() && !e.bot_notes?.trim()) continue;
    if (e.category !== current) {
      current = e.category;
      out.push(`\n## ${current}`);
    }
    out.push(`### ${e.title}`);
    if (e.content?.trim()) out.push(`Réponse type :\n${e.content.trim()}`);
    if (e.bot_notes?.trim()) out.push(`[Consigne interne, ne pas montrer au client] ${e.bot_notes.trim()}`);
  }
  return out.join('\n').trim();
}
