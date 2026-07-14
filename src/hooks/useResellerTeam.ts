import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { invokeEdgeFunction } from '../utils/invokeEdgeFunction';

export interface TeamMember {
  id: string;
  profile_id: string;
  is_primary: boolean;
  created_at: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  activated_at: string | null;
}

type ContactRow = {
  id: string;
  profile_id: string;
  is_primary: boolean;
  created_at: string;
  profiles: { first_name: string; last_name: string; email: string; phone: string | null; activated_at: string | null };
};

export const useResellerTeam = (resellerId: string | undefined) => {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTeam = useCallback(async () => {
    if (!resellerId) {
      setMembers([]);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);

      const { data, error: fetchError } = await supabase
        .from('reseller_contacts')
        .select('id, profile_id, is_primary, created_at, profiles!inner(first_name, last_name, email, phone, activated_at)')
        .eq('reseller_id', resellerId)
        .order('created_at', { ascending: true });

      if (fetchError) {
        throw new Error(fetchError.message);
      }

      setMembers(
        ((data || []) as unknown as ContactRow[]).map((c) => ({
          id: c.id,
          profile_id: c.profile_id,
          is_primary: c.is_primary,
          created_at: c.created_at,
          first_name: c.profiles.first_name,
          last_name: c.profiles.last_name,
          email: c.profiles.email,
          phone: c.profiles.phone,
          activated_at: c.profiles.activated_at,
        }))
      );
    } catch (err) {
      console.error("Erreur lors du chargement de l'équipe:", err);
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  }, [resellerId]);

  const inviteTeammate = async (
    email: string,
    firstName: string,
    lastName: string,
    password?: string,
    phone?: string
  ): Promise<{ success: boolean; error?: string; convertedExistingAccount?: boolean }> => {
    if (!resellerId) return { success: false, error: 'Compte revendeur introuvable' };

    const { data, error } = await invokeEdgeFunction<{ converted_existing_account?: boolean }>('invite-reseller-contact', {
      reseller_id: resellerId,
      email,
      first_name: firstName,
      last_name: lastName,
      password: password || undefined,
      phone: phone || undefined,
    });

    if (error) {
      return { success: false, error };
    }

    await fetchTeam();
    return { success: true, convertedExistingAccount: data?.converted_existing_account };
  };

  const removeTeammate = async (contactId: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const { error: deleteError } = await supabase.from('reseller_contacts').delete().eq('id', contactId);
      if (deleteError) {
        throw new Error(deleteError.message);
      }
      await fetchTeam();
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Erreur inconnue' };
    }
  };

  useEffect(() => {
    fetchTeam();
  }, [fetchTeam]);

  return { members, loading, error, refresh: fetchTeam, inviteTeammate, removeTeammate };
};
