import { supabase } from '../lib/supabase';

// Résultat d'une tentative de validation par scan d'un code-barres.
export type ValidationOutcome =
  | { status: 'validated'; productId: string; productName: string }
  | { status: 'already-online'; productId: string; productName: string }
  | { status: 'no-photos'; productId: string; productName: string }
  | { status: 'no-price'; productId: string; productName: string }
  | { status: 'not-found' }
  | { status: 'error'; message: string };

/**
 * Valide un produit à partir du code-barres scanné : si trouvé et pas déjà en
 * ligne, passe son `status` à `for-sale-online` (mise en ligne sur le storefront).
 * Le code-barres correspond à `products.barcode` (= la référence OZ-…).
 */
export async function validateProductByBarcode(code: string): Promise<ValidationOutcome> {
  const trimmed = code.trim();
  if (!trimmed) return { status: 'not-found' };
  try {
    const { data: product, error } = await supabase
      .from('products')
      .select('id, name, status, images, sale_price')
      .eq('barcode', trimmed)
      .maybeSingle();

    if (error) throw error;
    if (!product) return { status: 'not-found' };
    if (product.status === 'for-sale-online') {
      return { status: 'already-online', productId: product.id, productName: product.name };
    }
    // Garde-fou : pas de mise en ligne sans au moins une photo.
    if (!Array.isArray(product.images) || product.images.length === 0) {
      return { status: 'no-photos', productId: product.id, productName: product.name };
    }
    // Garde-fou : pas de mise en ligne sans prix de vente.
    if (!product.sale_price || Number(product.sale_price) <= 0) {
      return { status: 'no-price', productId: product.id, productName: product.name };
    }

    const { error: upErr } = await supabase
      .from('products')
      .update({ status: 'for-sale-online' })
      .eq('id', product.id);
    if (upErr) throw upErr;

    return { status: 'validated', productId: product.id, productName: product.name };
  } catch (e) {
    return { status: 'error', message: (e as Error).message };
  }
}