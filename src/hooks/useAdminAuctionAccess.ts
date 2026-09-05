import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export interface AuctionAccessGrant {
  id: string;
  user_id: string;
  session_id: string | null;
  access_type: 'weekly_pass' | 'monthly_sub';
  valid_until: string;
  price_paid: number;
  created_at: string;
  requester_name: string;
  requester_email: string | null;
  company_name: string;
  session_title: string | null;
}

type Row = {
  id: string;
  user_id: string;
  session_id: string | null;
  access_type: 'weekly_pass' | 'monthly_sub';
  valid_until: string;
  price_paid: number;
  created_at: string;
  profiles: { first_name: string | null; last_name: string | null; email: string | null } | null;
  auction_sessions: { title: string } | null;
};

/** Pass/abonnements enchères (auction_access, voir 0104) — table préparée
 * pour une future passerelle de paiement, pas encore appliquée à la RLS
 * (voir commentaire de la migration) : "Offrir un accès" reste pour
 * l'instant la seule façon de peupler cette table, via grantAccess
 * ci-dessous (price_paid=0). */
export const useAdminAuctionAccess = (isAdmin: boolean = false) => {
  const [grants, setGrants] = useState<AuctionAccessGrant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchGrants = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const { data, error: fetchError } = await supabase
        .from('auction_access')
        .select('*, profiles(first_name, last_name, email), auction_sessions(title)')
        .order('created_at', { ascending: false });
      if (fetchError) throw new Error(fetchError.message);

      const rows = (data || []) as unknown as Row[];
      const profileIds = [...new Set(rows.map((r) => r.user_id))];
      let companyByProfile = new Map<string, string>();
      if (profileIds.length > 0) {
        const { data: contacts, error: contactsError } = await supabase
          .from('reseller_contacts')
          .select('profile_id, resellers(company_name)')
          .in('profile_id', profileIds);
        if (contactsError) throw new Error(contactsError.message);
        companyByProfile = new Map(
          ((contacts || []) as unknown as { profile_id: string; resellers: { company_name: string } | null }[]).map((c) => [
            c.profile_id,
            c.resellers?.company_name || '—',
          ])
        );
      }

      setGrants(
        rows.map((r) => {
          const name = `${r.profiles?.first_name || ''} ${r.profiles?.last_name || ''}`.trim();
          return {
            id: r.id,
            user_id: r.user_id,
            session_id: r.session_id,
            access_type: r.access_type,
            valid_until: r.valid_until,
            price_paid: Number(r.price_paid) || 0,
            created_at: r.created_at,
            requester_name: name || r.profiles?.email || '—',
            requester_email: r.profiles?.email || null,
            company_name: companyByProfile.get(r.user_id) || '—',
            session_title: r.auction_sessions?.title || null,
          };
        })
      );
    } catch (err) {
      console.error('Erreur lors du chargement des accès enchères:', err);
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
    fetchGrants();
  }, [isAdmin, fetchGrants]);

  const grantAccess = async (
    userId: string,
    sessionId: string,
    validUntil: string
  ): Promise<{ success: boolean; error?: string }> => {
    const { error: insertError } = await supabase.from('auction_access').insert({
      user_id: userId,
      session_id: sessionId,
      access_type: 'weekly_pass',
      valid_until: validUntil,
      price_paid: 0,
    });
    if (insertError) return { success: false, error: insertError.message };
    await fetchGrants();
    return { success: true };
  };

  return { grants, loading, error, refresh: fetchGrants, grantAccess };
};
