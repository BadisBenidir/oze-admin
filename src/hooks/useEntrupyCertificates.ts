import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export interface EntrupyCertificateItem {
  id: string;
  order_id: string;
  order_number: string;
  order_created_at: string;
  product_name: string;
  product_reference: string | null;
  product_image: string | null;
  /** Toutes les photos du produit (pas seulement la principale) — pour la
   * visionneuse en grand de la modale de détail. */
  product_images: string[];
  quantity: number;
  unit_price: number;
  line_total: number;
  reseller_company_name: string;
  requester_name: string;
  requester_email: string | null;
  entrupy_status: 'pending' | 'completed';
  entrupy_cert_url: string | null;
  entrupy_pdf_path: string | null;
  entrupy_completed_at: string | null;
  /** Date de paiement réel du certificat (19,99 €) — le revendeur paie à la
   * demande, pas à l'édition du certificat (voir entrupy_requested_at,
   * 0119) : sert au calcul du CA, distinct de entrupy_completed_at qui sert
   * lui au quota Entrupy réellement consommé (l'authentification physique a
   * lieu à l'édition, pas à la demande). Repli sur order_created_at pour les
   * certificats choisis dès le panier (entrupy_requested_at reste null dans
   * ce cas, voir 0119). */
  paid_at: string;
}

type Row = {
  id: string;
  entrupy_status: 'pending' | 'completed';
  entrupy_cert_url: string | null;
  entrupy_pdf_path: string | null;
  entrupy_completed_at: string | null;
  entrupy_requested_at: string | null;
  quantity: number;
  unit_price: number;
  line_total: number;
  product_snapshot: { name?: string; reference?: string; product_code?: string; images?: string[]; main_image_index?: number } | null;
  order: {
    id: string;
    order_number: string;
    created_at: string;
    reseller: { company_name: string } | null;
    placed_by: { first_name: string | null; last_name: string | null; email: string | null } | null;
  } | null;
};

const SELECT_COLUMNS =
  'id, entrupy_status, entrupy_cert_url, entrupy_pdf_path, entrupy_completed_at, entrupy_requested_at, quantity, unit_price, line_total, product_snapshot, ' +
  'order:orders!inner(id, order_number, created_at, reseller:resellers(company_name), placed_by:profiles!placed_by_profile_id(first_name, last_name, email))';

const mapRow = (row: Row): EntrupyCertificateItem => {
  const requesterName = `${row.order?.placed_by?.first_name || ''} ${row.order?.placed_by?.last_name || ''}`.trim();
  return {
    id: row.id,
    order_id: row.order?.id || '',
    order_number: row.order?.order_number || '—',
    order_created_at: row.order?.created_at || '',
    product_name: row.product_snapshot?.name || 'Article',
    product_reference: row.product_snapshot?.reference || row.product_snapshot?.product_code || null,
    product_image: row.product_snapshot?.images?.[row.product_snapshot?.main_image_index ?? 0] || row.product_snapshot?.images?.[0] || null,
    product_images: row.product_snapshot?.images || [],
    quantity: row.quantity,
    unit_price: Number(row.unit_price) || 0,
    line_total: Number(row.line_total) || 0,
    reseller_company_name: row.order?.reseller?.company_name || '—',
    requester_name: requesterName || row.order?.placed_by?.email || '—',
    requester_email: row.order?.placed_by?.email || null,
    entrupy_status: row.entrupy_status,
    entrupy_cert_url: row.entrupy_cert_url,
    entrupy_pdf_path: row.entrupy_pdf_path,
    entrupy_completed_at: row.entrupy_completed_at,
    paid_at: row.entrupy_requested_at || row.order?.created_at || '',
  };
};

/** Suivi des certificats Entrupy à éditer/déjà édités — page admin "Entrupy". */
export const useEntrupyCertificates = (isAdmin: boolean = false) => {
  const [items, setItems] = useState<EntrupyCertificateItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchItems = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const { data, error: fetchError } = await supabase
        .from('order_items')
        .select(SELECT_COLUMNS)
        .eq('entrupy_requested', true)
        .order('created_at', { ascending: true });
      if (fetchError) throw new Error(fetchError.message);
      setItems(((data || []) as unknown as Row[]).map(mapRow));
    } catch (err) {
      console.error('Erreur lors du chargement des certificats Entrupy:', err);
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    fetchItems();
  }, [isAdmin, fetchItems]);

  const importCertificate = async (
    itemId: string,
    certUrl: string,
    pdfPath: string | null = null
  ): Promise<{ success: boolean; error?: string }> => {
    const { error: rpcError } = await supabase.rpc('admin_import_entrupy_certificate', {
      p_order_item_id: itemId,
      p_cert_url: certUrl,
      p_pdf_path: pdfPath,
    });
    if (rpcError) return { success: false, error: rpcError.message };
    await fetchItems();
    return { success: true };
  };

  /** Retire un certificat déjà importé (repasse l'article en 'pending') — le
   * fichier déposé sur Storage n'est volontairement pas supprimé (pas de
   * policy DELETE garantie sur le bucket, voir 0155), juste dé-référencé. */
  const deleteCertificate = async (itemId: string): Promise<{ success: boolean; error?: string }> => {
    const { error: rpcError } = await supabase.rpc('admin_delete_entrupy_certificate', { p_order_item_id: itemId });
    if (rpcError) return { success: false, error: rpcError.message };
    await fetchItems();
    return { success: true };
  };

  /** Upload d'un PDF dans le bucket public `entrupy-certificates` — même
   * pattern que products-images (CreateProduct.tsx), pas d'URL signée dans
   * ce repo. Renvoie l'URL publique + le chemin de stockage. */
  const uploadPdf = async (itemId: string, file: File): Promise<{ success: boolean; url?: string; path?: string; error?: string }> => {
    const fileName = `${itemId}-${Date.now()}.pdf`;
    const { error: uploadError } = await supabase.storage
      .from('entrupy-certificates')
      .upload(fileName, file, { cacheControl: '3600', upsert: false, contentType: 'application/pdf' });
    if (uploadError) return { success: false, error: uploadError.message };

    const { data } = supabase.storage.from('entrupy-certificates').getPublicUrl(fileName);
    return { success: true, url: data.publicUrl, path: fileName };
  };

  return { items, loading, error, refresh: fetchItems, importCertificate, uploadPdf, deleteCertificate };
};

/** Compteur léger pour le badge de la barre latérale — certificats encore en attente d'édition. */
export const usePendingEntrupyCount = (isAdmin: boolean = false) => {
  const [count, setCount] = useState(0);

  const fetchCount = useCallback(async () => {
    const { count: rowCount, error } = await supabase
      .from('order_items')
      .select('id', { count: 'exact', head: true })
      .eq('entrupy_requested', true)
      .eq('entrupy_status', 'pending');
    if (error) {
      console.error('Erreur lors du chargement du compteur de certificats Entrupy:', error);
      return;
    }
    setCount(rowCount || 0);
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    fetchCount();
  }, [isAdmin, fetchCount]);

  return count;
};

/** Mois courant au format 'YYYY-MM', clé de public.entrupy_manual_adjustments. */
const currentMonthKey = (): string => new Date().toISOString().slice(0, 7);

/**
 * Certificats réalisés manuellement hors plateforme ce mois-ci (ex. avant
 * mise en place de cet onglet, ou en dépannage) — à additionner aux
 * certificats `completed` du mois pour le quota Entrupy et le CA réels
 * (voir 0155, qui seed 1 pour le mois de création de cette fonctionnalité).
 */
export const useEntrupyManualAdjustment = (isAdmin: boolean = false) => {
  const [count, setCountState] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchCount = useCallback(async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('entrupy_manual_adjustments')
        .select('count')
        .eq('month', currentMonthKey())
        .maybeSingle();
      if (error) throw new Error(error.message);
      setCountState(data?.count || 0);
    } catch (err) {
      console.error('Erreur lors du chargement de l\'ajustement manuel Entrupy:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    fetchCount();
  }, [isAdmin, fetchCount]);

  const setCount = async (value: number): Promise<{ success: boolean; error?: string }> => {
    setSaving(true);
    const { error } = await supabase
      .from('entrupy_manual_adjustments')
      .upsert({ month: currentMonthKey(), count: value, updated_at: new Date().toISOString() }, { onConflict: 'month' });
    setSaving(false);
    if (error) return { success: false, error: error.message };
    setCountState(value);
    return { success: true };
  };

  return { count, loading, saving, setCount };
};
