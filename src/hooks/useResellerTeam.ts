import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { invokeEdgeFunction } from '../utils/invokeEdgeFunction';
import { generateSecurePassword } from '../utils/generatePassword';

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
  /** Groupe d'accès (0211) : 1 offert, 2 = 300 €, 3 = 700 €, 4 nouveau ; null = non classé. */
  member_group: number | null;
}

type ContactRow = {
  id: string;
  profile_id: string;
  is_primary: boolean;
  created_at: string;
  member_group: number | null;
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
        .select('id, profile_id, is_primary, created_at, member_group, profiles!inner(first_name, last_name, email, phone, activated_at)')
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
          member_group: c.member_group ?? null,
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
    const { error } = await invokeEdgeFunction('delete-reseller-contact', { contact_id: contactId });
    if (error) {
      return { success: false, error };
    }
    await fetchTeam();
    return { success: true };
  };

  const resetTeammatePassword = async (
    profileId: string
  ): Promise<{ success: boolean; error?: string; password?: string; sessionsRevoked?: boolean }> => {
    const password = generateSecurePassword();
    const { data, error } = await invokeEdgeFunction<{ sessions_revoked?: boolean }>('reset-reseller-password', {
      profile_id: profileId,
      password,
    });

    if (error) {
      return { success: false, error };
    }

    return { success: true, password, sessionsRevoked: data?.sessions_revoked !== false };
  };

  useEffect(() => {
    fetchTeam();
  }, [fetchTeam]);

  /** Classe un membre dans un groupe d'accès (contact principal, 0211) — mise à jour immédiate de la liste. */
  const setMemberGroup = async (contactId: string, group: number | null): Promise<{ success: boolean; error?: string }> => {
    setMembers((prev) => prev.map((m) => (m.id === contactId ? { ...m, member_group: group } : m)));
    const { error: rpcError } = await supabase.rpc('set_member_group', { p_contact_id: contactId, p_group: group });
    if (rpcError) {
      await fetchTeam();
      return { success: false, error: rpcError.message };
    }
    return { success: true };
  };

  return { members, loading, error, refresh: fetchTeam, inviteTeammate, removeTeammate, resetTeammatePassword, setMemberGroup };
};
