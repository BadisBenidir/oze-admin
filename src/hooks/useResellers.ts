import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export interface Reseller {
  id: string;
  company_name: string;
  legal_id: string | null;
  status: 'pending' | 'active' | 'suspended';
  discount_percent: number;
  contact_email: string | null;
  contact_phone: string | null;
  billing_address: Record<string, unknown> | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  contacts_count: number;
}

export interface ResellerFormData {
  company_name: string;
  legal_id: string;
  discount_percent: number;
  contact_email: string;
  contact_phone: string;
  notes: string;
}

export interface ResellerContact {
  id: string;
  reseller_id: string;
  profile_id: string;
  is_primary: boolean;
  created_at: string;
  first_name: string;
  last_name: string;
  email: string;
}

interface UseResellersResult {
  resellers: Reseller[];
  loading: boolean;
  error: string | null;
  refreshResellers: () => Promise<void>;
  createReseller: (data: ResellerFormData) => Promise<{ success: boolean; error?: string }>;
  updateReseller: (id: string, data: Partial<ResellerFormData>) => Promise<{ success: boolean; error?: string }>;
  updateResellerStatus: (id: string, status: Reseller['status']) => Promise<{ success: boolean; error?: string }>;
  deleteReseller: (id: string) => Promise<{ success: boolean; error?: string }>;
  fetchContacts: (resellerId: string) => Promise<ResellerContact[]>;
  inviteContact: (resellerId: string, email: string, firstName: string, lastName: string, password?: string) => Promise<{ success: boolean; error?: string }>;
  removeContact: (contactId: string) => Promise<{ success: boolean; error?: string }>;
}

export const useResellers = (isAuthenticated: boolean = false): UseResellersResult => {
  const [resellers, setResellers] = useState<Reseller[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchResellers = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const { data, error: fetchError } = await supabase
        .from('resellers')
        .select('*, reseller_contacts(count)')
        .order('created_at', { ascending: false });

      if (fetchError) {
        throw new Error(fetchError.message);
      }

      const transformed: Reseller[] = (data || []).map((r: Reseller & { reseller_contacts: { count: number }[] }) => ({
        ...r,
        contacts_count: r.reseller_contacts?.[0]?.count ?? 0,
      }));

      setResellers(transformed);
    } catch (err) {
      console.error('Erreur lors du chargement des revendeurs:', err);
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshResellers = async () => {
    await fetchResellers();
  };

  const createReseller = async (data: ResellerFormData): Promise<{ success: boolean; error?: string }> => {
    try {
      const { error: insertError } = await supabase
        .from('resellers')
        .insert([{
          company_name: data.company_name.trim(),
          legal_id: data.legal_id || null,
          discount_percent: data.discount_percent,
          contact_email: data.contact_email || null,
          contact_phone: data.contact_phone || null,
          notes: data.notes || null,
        }]);

      if (insertError) {
        throw new Error(insertError.message);
      }

      await fetchResellers();
      return { success: true };
    } catch (err) {
      console.error('Erreur lors de la création du revendeur:', err);
      return { success: false, error: err instanceof Error ? err.message : 'Erreur inconnue' };
    }
  };

  const updateReseller = async (id: string, data: Partial<ResellerFormData>): Promise<{ success: boolean; error?: string }> => {
    try {
      const { error: updateError } = await supabase
        .from('resellers')
        .update(data)
        .eq('id', id);

      if (updateError) {
        throw new Error(updateError.message);
      }

      await fetchResellers();
      return { success: true };
    } catch (err) {
      console.error('Erreur lors de la mise à jour du revendeur:', err);
      return { success: false, error: err instanceof Error ? err.message : 'Erreur inconnue' };
    }
  };

  const updateResellerStatus = async (id: string, status: Reseller['status']): Promise<{ success: boolean; error?: string }> => {
    try {
      const { error: updateError } = await supabase
        .from('resellers')
        .update({ status })
        .eq('id', id);

      if (updateError) {
        throw new Error(updateError.message);
      }

      await fetchResellers();
      return { success: true };
    } catch (err) {
      console.error('Erreur lors du changement de statut du revendeur:', err);
      return { success: false, error: err instanceof Error ? err.message : 'Erreur inconnue' };
    }
  };

  const deleteReseller = async (id: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const { error: deleteError } = await supabase
        .from('resellers')
        .delete()
        .eq('id', id);

      if (deleteError) {
        if (deleteError.code === '23503') {
          return { success: false, error: 'Impossible de supprimer : ce revendeur a des commandes ou contacts associés. Suspendez-le plutôt.' };
        }
        throw new Error(deleteError.message);
      }

      await fetchResellers();
      return { success: true };
    } catch (err) {
      console.error('Erreur lors de la suppression du revendeur:', err);
      return { success: false, error: err instanceof Error ? err.message : 'Erreur inconnue' };
    }
  };

  const fetchContacts = async (resellerId: string): Promise<ResellerContact[]> => {
    const { data, error: fetchError } = await supabase
      .from('reseller_contacts')
      .select('id, reseller_id, profile_id, is_primary, created_at, profiles!inner(first_name, last_name, email)')
      .eq('reseller_id', resellerId)
      .order('created_at', { ascending: true });

    if (fetchError) {
      throw new Error(fetchError.message);
    }

    type ContactRow = {
      id: string;
      reseller_id: string;
      profile_id: string;
      is_primary: boolean;
      created_at: string;
      profiles: { first_name: string; last_name: string; email: string };
    };

    return ((data || []) as unknown as ContactRow[]).map((c) => ({
      id: c.id,
      reseller_id: c.reseller_id,
      profile_id: c.profile_id,
      is_primary: c.is_primary,
      created_at: c.created_at,
      first_name: c.profiles.first_name,
      last_name: c.profiles.last_name,
      email: c.profiles.email,
    }));
  };

  const inviteContact = async (
    resellerId: string,
    email: string,
    firstName: string,
    lastName: string,
    password?: string
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('invite-reseller-contact', {
        body: { reseller_id: resellerId, email, first_name: firstName, last_name: lastName, password: password || undefined },
      });

      if (invokeError) {
        const message = (data && (data.error || data.message)) || invokeError.message || "Échec de l'invitation";
        throw new Error(message);
      }

      if (data?.error) {
        throw new Error(data.error);
      }

      return { success: true };
    } catch (err) {
      console.error("Erreur lors de l'invitation du contact:", err);
      return { success: false, error: err instanceof Error ? err.message : 'Erreur inconnue' };
    }
  };

  const removeContact = async (contactId: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const { error: deleteError } = await supabase
        .from('reseller_contacts')
        .delete()
        .eq('id', contactId);

      if (deleteError) {
        throw new Error(deleteError.message);
      }

      return { success: true };
    } catch (err) {
      console.error('Erreur lors de la suppression du contact:', err);
      return { success: false, error: err instanceof Error ? err.message : 'Erreur inconnue' };
    }
  };

  useEffect(() => {
    if (!isAuthenticated) {
      setLoading(false);
      return;
    }

    fetchResellers();
  }, [isAuthenticated, fetchResellers]);

  return {
    resellers,
    loading,
    error,
    refreshResellers,
    createReseller,
    updateReseller,
    updateResellerStatus,
    deleteReseller,
    fetchContacts,
    inviteContact,
    removeContact,
  };
};
