import React, { useEffect, useMemo, useState } from 'react';
import { X, AlertCircle, Search, User } from 'lucide-react';
import { supabase } from '../../../../lib/supabase';
import { AuctionSession } from '../../../../hooks/useAdminAuctionSessions';

interface ResellerContact {
  profile_id: string;
  name: string;
  email: string | null;
  company_name: string;
}

interface GrantAuctionAccessModalProps {
  isOpen: boolean;
  onClose: () => void;
  sessions: AuctionSession[];
  onGrant: (userId: string, sessionId: string, validUntil: string) => Promise<{ success: boolean; error?: string }>;
}

/** "Offrir un accès" — pass gratuit (price_paid=0) pour un sous-compte
 * précis, valable jusqu'à la fin de la session choisie. Voir
 * auction_access, 0104_auction_system.sql. */
export const GrantAuctionAccessModal: React.FC<GrantAuctionAccessModalProps> = ({ isOpen, onClose, sessions, onGrant }) => {
  const [contacts, setContacts] = useState<ResellerContact[]>([]);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<ResellerContact | null>(null);
  const [sessionId, setSessionId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const upcomingSessions = useMemo(() => sessions.filter((s) => s.status !== 'closed'), [sessions]);

  useEffect(() => {
    if (!isOpen) return;
    setSelected(null);
    setSearch('');
    setError('');
    setSessionId(upcomingSessions[0]?.id || '');
    supabase
      .from('reseller_contacts')
      .select('profile_id, profiles(first_name, last_name, email), resellers(company_name)')
      .then(({ data }) => {
        const rows = (data || []) as unknown as { profile_id: string; profiles: { first_name: string | null; last_name: string | null; email: string | null } | null; resellers: { company_name: string } | null }[];
        setContacts(
          rows.map((r) => ({
            profile_id: r.profile_id,
            name: `${r.profiles?.first_name || ''} ${r.profiles?.last_name || ''}`.trim() || r.profiles?.email || '—',
            email: r.profiles?.email || null,
            company_name: r.resellers?.company_name || '—',
          }))
        );
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return contacts.slice(0, 20);
    return contacts.filter((c) => c.name.toLowerCase().includes(term) || c.company_name.toLowerCase().includes(term) || c.email?.toLowerCase().includes(term)).slice(0, 20);
  }, [contacts, search]);

  if (!isOpen) return null;

  const handleClose = () => onClose();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected) {
      setError('Sélectionne un revendeur');
      return;
    }
    const session = sessions.find((s) => s.id === sessionId);
    if (!session) {
      setError('Sélectionne une session');
      return;
    }
    setSubmitting(true);
    setError('');
    const result = await onGrant(selected.profile_id, session.id, session.ends_at);
    setSubmitting(false);
    if (!result.success) {
      setError(result.error || "Erreur lors de l'attribution");
      return;
    }
    handleClose();
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black bg-opacity-25" onClick={handleClose} />
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between p-5 border-b border-gray-100 flex-shrink-0">
            <h3 className="text-base font-semibold text-gray-900">Offrir un accès</h3>
            <button onClick={handleClose} className="p-1 text-gray-400 hover:text-gray-600 rounded-lg transition-colors">
              <X className="h-5 w-5" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
            <div className="p-5 space-y-3 overflow-y-auto flex-1">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Session</label>
                <select
                  value={sessionId}
                  onChange={(e) => setSessionId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
                >
                  {upcomingSessions.length === 0 ? (
                    <option value="">Aucune session à venir</option>
                  ) : (
                    upcomingSessions.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)
                  )}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Revendeur</label>
                {selected ? (
                  <div className="flex items-center justify-between px-3 py-2 border border-gray-200 rounded-lg bg-gray-50">
                    <div className="min-w-0">
                      <p className="text-sm text-gray-900 truncate">{selected.name}</p>
                      <p className="text-xs text-gray-500 truncate">{selected.company_name}</p>
                    </div>
                    <button type="button" onClick={() => setSelected(null)} className="text-gray-400 hover:text-red-600 flex-shrink-0">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="relative mb-1.5">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                      <input
                        type="text"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Nom, email ou entreprise..."
                        className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-gray-400"
                      />
                    </div>
                    <div className="border border-gray-200 rounded-lg max-h-48 overflow-y-auto divide-y divide-gray-100">
                      {filtered.length === 0 ? (
                        <div className="p-3 text-center text-xs text-gray-500">Aucun résultat</div>
                      ) : (
                        filtered.map((c) => (
                          <button
                            type="button"
                            key={c.profile_id}
                            onClick={() => setSelected(c)}
                            className="w-full flex items-center gap-2 p-2.5 text-left hover:bg-gray-50"
                          >
                            <div className="h-7 w-7 bg-gray-100 rounded-full flex items-center justify-center flex-shrink-0">
                              <User className="h-3.5 w-3.5 text-gray-400" />
                            </div>
                            <div className="min-w-0">
                              <p className="text-xs font-medium text-gray-900 truncate">{c.name}</p>
                              <p className="text-xs text-gray-500 truncate">{c.company_name}</p>
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  </>
                )}
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-center space-x-2">
                  <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0" />
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              )}
            </div>

            <div className="flex justify-end space-x-3 p-5 pt-4 border-t border-gray-100 flex-shrink-0">
              <button type="button" onClick={handleClose} className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors text-sm">
                Annuler
              </button>
              <button
                type="submit"
                disabled={submitting || !selected || !sessionId}
                className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50 text-sm font-medium"
              >
                {submitting ? 'Attribution...' : "Offrir l'accès"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default GrantAuctionAccessModal;
