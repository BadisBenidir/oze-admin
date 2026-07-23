import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export interface ResellerInviteLink {
  id: string;
  reseller_id: string;
  token: string;
  is_active: boolean;
  max_uses: number | null;
  use_count: number;
  created_by: string | null;
  created_at: string;
  revoked_at: string | null;
}

// Toujours pro.ozeparis.com, même quand le lien est généré depuis
// admin.ozeparis.com (même projet Vercel, deux domaines) : c'est le domaine
// destiné aux revendeurs/collègues, pas celui de l'admin OZË.
const INVITE_LINK_ORIGIN = 'https://pro.ozeparis.com';

/** URL publique à transmettre au contact principal ou à ses collègues. */
export const buildResellerInviteUrl = (token: string): string => {
  return `${INVITE_LINK_ORIGIN}/invite/team?token=${token}`;
};

export const useResellerInviteLinks = (resellerId: string | undefined) => {
  const [links, setLinks] = useState<ResellerInviteLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLinks = useCallback(async () => {
    if (!resellerId) {
      setLinks([]);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const { data, error: fetchError } = await supabase
        .from('reseller_invite_links')
        .select('*')
        .eq('reseller_id', resellerId)
        .order('created_at', { ascending: false });

      if (fetchError) throw new Error(fetchError.message);
      setLinks(data || []);
    } catch (err) {
      console.error("Erreur lors du chargement des liens d'invitation:", err);
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  }, [resellerId]);

  const createLink = async (): Promise<{ success: boolean; error?: string }> => {
    if (!resellerId) return { success: false, error: 'Entreprise introuvable' };
    const { data: userData } = await supabase.auth.getUser();
    const { error: insertError } = await supabase
      .from('reseller_invite_links')
      .insert({ reseller_id: resellerId, created_by: userData?.user?.id ?? null });

    if (insertError) {
      return { success: false, error: insertError.message };
    }
    await fetchLinks();
    return { success: true };
  };

  const setLinkActive = async (linkId: string, isActive: boolean): Promise<{ success: boolean; error?: string }> => {
    const { error: updateError } = await supabase
      .from('reseller_invite_links')
      .update({ is_active: isActive, revoked_at: isActive ? null : new Date().toISOString() })
      .eq('id', linkId);

    if (updateError) {
      return { success: false, error: updateError.message };
    }
    await fetchLinks();
    return { success: true };
  };

  useEffect(() => {
    fetchLinks();
  }, [fetchLinks]);

  return { links, loading, error, refresh: fetchLinks, createLink, setLinkActive };
};
