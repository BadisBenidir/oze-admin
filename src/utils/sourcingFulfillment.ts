import { supabase } from '../lib/supabase';

/**
 * Commandes de SUIVI des missions de sourcing clôturées par l'admin
 * (« Générer la commande », 0197/0204) : elles servent uniquement à suivre la
 * réception et la livraison des pièces, jamais aux chiffres. La mission
 * reste comptée comme avant (vente à la clôture) — ces commandes doivent
 * donc être exclues de tout total (CA, marge, ventes, panier moyen…).
 *
 * Identifiées par le marqueur de mission order_generated_by_admin (présent
 * dès 0197), pas par orders.is_sourcing_fulfillment (0204), pour rester
 * correct quel que soit l'ordre d'application des migrations.
 */
export const fetchSourcingFulfillmentOrderIds = async (): Promise<Set<string>> => {
  const { data, error } = await supabase
    .from('b2b_sourcing_missions')
    .select('order_id')
    .eq('order_generated_by_admin', true)
    .not('order_id', 'is', null);
  if (error) return new Set();
  return new Set((data || []).map((m) => m.order_id as string));
};
