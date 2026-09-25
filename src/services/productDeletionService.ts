import { supabase } from '../lib/supabase';

export interface DeleteProductOutcome {
  /** Supprimé définitivement. */
  deleted: boolean;
  /** Encore référencé ailleurs (historique de commande, cadeau...) : archivé à la place. */
  archived: boolean;
}

/** Supprime un produit via admin_delete_product (0164) — jamais de DELETE
 * direct : sans policy DELETE admin, la RLS l'ignorait silencieusement.
 * Lève une erreur lisible si la suppression est refusée. */
export const deleteProductAdmin = async (productId: string): Promise<DeleteProductOutcome> => {
  const { data, error } = await supabase.rpc('admin_delete_product', { p_product_id: productId });
  if (error) throw new Error(error.message);
  const result = (data || {}) as Partial<DeleteProductOutcome>;
  return { deleted: Boolean(result.deleted), archived: Boolean(result.archived) };
};

export const archivedNotice = (name: string) =>
  `« ${name} » est lié à une ancienne commande ou à un cadeau : il a été archivé à la place (historique conservé, retiré du stock et des statistiques).`;
