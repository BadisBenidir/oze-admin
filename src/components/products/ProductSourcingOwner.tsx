import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

interface SourcingOwner {
  client: string;
  company: string | null;
  reference: string | null;
  title: string;
  status: string;
}

/**
 * Fiche produit : à qui appartient l'article sourcé (b2b_sourcing_items ->
 * mission -> revendeur / demandeur). N'affiche rien si l'article ne vient
 * d'aucune mission de sourcing.
 */
export const ProductSourcingOwner: React.FC<{ productId: string }> = ({ productId }) => {
  const [owner, setOwner] = useState<SourcingOwner | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data, error } = await supabase
        .from('b2b_sourcing_items')
        .select('status, created_at, mission:b2b_sourcing_missions!inner(reference, title, status, reseller:resellers(company_name), requester:profiles!user_id(first_name, last_name, email))')
        .eq('product_id', productId)
        .order('created_at', { ascending: false });
      if (error || !alive) return;
      type Row = {
        status: string;
        mission: {
          reference: string | null;
          title: string;
          status: string;
          reseller: { company_name: string } | null;
          requester: { first_name: string | null; last_name: string | null; email: string | null } | null;
        };
      };
      const rows = (data || []) as unknown as Row[];
      const row = rows.find((r) => r.status !== 'cancelled' && r.mission.status !== 'cancelled') || rows[0];
      if (!row) return setOwner(null);
      const m = row.mission;
      const person = m.requester ? `${m.requester.first_name || ''} ${m.requester.last_name || ''}`.trim() || m.requester.email : null;
      const company = m.reseller?.company_name || null;
      setOwner({
        client: person || company || '—',
        company: person && company && company !== person ? company : null,
        reference: m.reference,
        title: m.title,
        status: m.status,
      });
    })();
    return () => {
      alive = false;
    };
  }, [productId]);

  if (!owner) return null;
  return (
    <div className="mt-2 inline-flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-lg border border-purple-200 bg-purple-50 px-3 py-1.5 text-sm text-purple-900">
      <span>🎯 Sourcing de</span>
      <span className="font-semibold">{owner.client}</span>
      {owner.company && <span className="text-purple-700">({owner.company})</span>}
      <span className="text-xs text-purple-700">
        {[owner.reference, owner.title].filter(Boolean).join(' · ')}
        {owner.status === 'cancelled' && ' · mission annulée'}
      </span>
    </div>
  );
};
