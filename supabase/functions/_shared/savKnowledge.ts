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

export async function loadKnowledgeBase(admin: SupabaseClient): Promise<string> {
  const { data } = await admin
    .from('sav_knowledge_base')
    .select('title, content')
    .eq('active', true)
    .order('position');
  return (data || [])
    .filter((e: { content: string }) => e.content?.trim())
    .map((e: { title: string; content: string }) => `## ${e.title}\n${e.content.trim()}`)
    .join('\n\n');
}
