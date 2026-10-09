import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export interface PreviewLink {
  id: string;
  token: string;
  label: string | null;
  drop_id: string | null;
  session_id: string | null;
  /** null = toutes les pièces du drop / de la session. */
  item_ids: string[] | null;
  show_prices: boolean;
  /** Sessions d'enchères (0195) : prix affichés — départ, final (adjugé), les deux ou aucun. */
  price_mode: AuctionPriceMode | null;
  expires_at: string | null;
  revoked_at: string | null;
  view_count: number;
  last_viewed_at: string | null;
  created_at: string;
}

export type AuctionPriceMode = 'none' | 'start' | 'final' | 'both';

export type PreviewTarget = { kind: 'drop'; id: string } | { kind: 'auction'; id: string };

export interface PreviewLinkInput {
  label?: string;
  item_ids: string[] | null;
  show_prices: boolean;
  price_mode?: AuctionPriceMode | null;
  expires_at: string | null;
}

// Toujours pro.ozeparis.com, même depuis admin.ozeparis.com (même principe
// que buildResellerInviteUrl) : la page d'avant-première est publique et
// vit sur le domaine revendeurs, avec son bouton de connexion.
const PREVIEW_LINK_ORIGIN = 'https://pro.ozeparis.com';

export const buildPreviewLinkUrl = (token: string): string => `${PREVIEW_LINK_ORIGIN}/avant-premiere/${token}`;

/** Liens d'avant-première d'un drop ou d'une session d'enchères (preview_links, 0169). */
export const useAdminPreviewLinks = (target: PreviewTarget | null) => {
  const [links, setLinks] = useState<PreviewLink[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const column = target?.kind === 'drop' ? 'drop_id' : 'session_id';
  const targetId = target?.id ?? null;

  const fetchLinks = useCallback(async () => {
    if (!targetId) return;
    try {
      setLoading(true);
      setError(null);
      const { data, error: fetchError } = await supabase
        .from('preview_links')
        .select('*')
        .eq(column, targetId)
        .order('created_at', { ascending: false });
      if (fetchError) throw new Error(fetchError.message);
      setLinks(data || []);
    } catch (err) {
      console.error('Erreur lors du chargement des liens d\'avant-première:', err);
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  }, [column, targetId]);

  const createLink = async (input: PreviewLinkInput): Promise<{ success: boolean; error?: string; link?: PreviewLink }> => {
    if (!targetId) return { success: false, error: 'Cible manquante' };
    const { data: userData } = await supabase.auth.getUser();
    const { data, error: insertError } = await supabase
      .from('preview_links')
      .insert({
        [column]: targetId,
        label: input.label?.trim() || null,
        item_ids: input.item_ids,
        show_prices: input.show_prices,
        ...(input.price_mode ? { price_mode: input.price_mode } : {}),
        expires_at: input.expires_at,
        created_by: userData?.user?.id ?? null,
      })
      .select('*')
      .single();
    if (insertError) return { success: false, error: insertError.message };
    await fetchLinks();
    return { success: true, link: data as PreviewLink };
  };

  const revokeLink = async (id: string): Promise<{ success: boolean; error?: string }> => {
    const { error: updateError } = await supabase
      .from('preview_links')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', id);
    if (updateError) return { success: false, error: updateError.message };
    await fetchLinks();
    return { success: true };
  };

  const deleteLink = async (id: string): Promise<{ success: boolean; error?: string }> => {
    const { error: deleteError } = await supabase.from('preview_links').delete().eq('id', id);
    if (deleteError) return { success: false, error: deleteError.message };
    await fetchLinks();
    return { success: true };
  };

  useEffect(() => {
    if (!targetId) {
      setLinks([]);
      return;
    }
    fetchLinks();
  }, [targetId, fetchLinks]);

  return { links, loading, error, refresh: fetchLinks, createLink, revokeLink, deleteLink };
};
