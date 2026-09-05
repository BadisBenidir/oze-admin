import React, { useMemo, useState } from 'react';
import {
  Gavel, Plus, AlertCircle, Trophy, Radio, CheckCircle2, Trash2, ImageOff,
  Ticket, Receipt, Clock, Zap,
} from 'lucide-react';
import { Card, CardContent } from '../../ui/Card';
import { Badge } from '../../ui/Badge';
import { Toast } from '../../ui/Toast';
import { useAdminAuth } from '../../../hooks/useAdminAuth';
import { useAdminAuctionSessions, AuctionSession } from '../../../hooks/useAdminAuctionSessions';
import { useAdminAuctionItems, AdminAuctionItem } from '../../../hooks/useAdminAuctionItems';
import { useAdminAuctionAccess } from '../../../hooks/useAdminAuctionAccess';
import { AuctionSessionFormModal } from './auctions/AuctionSessionFormModal';
import { AuctionItemFormModal } from './auctions/AuctionItemFormModal';
import { GrantAuctionAccessModal } from './auctions/GrantAuctionAccessModal';
import { AuctionCountdown } from '../reseller/AuctionCountdown';

type AdminAuctionSection = 'sessions' | 'access' | 'results';

const EUR = (n: number) => (Number(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';

const sessionStatusBadge = (status: AuctionSession['status']) => {
  switch (status) {
    case 'live':
      return <Badge variant="successStrong"><Radio className="h-3 w-3 mr-1" />En direct</Badge>;
    case 'closed':
      return <Badge variant="default">Clôturée</Badge>;
    default:
      return <Badge variant="info">À venir</Badge>;
  }
};

const itemStatusBadge = (status: AdminAuctionItem['status']) => {
  if (status === 'sold') return <Badge variant="success">Adjugé</Badge>;
  if (status === 'unsold') return <Badge variant="warning">Non vendu</Badge>;
  return <Badge variant="info">En cours</Badge>;
};

/** Interface admin de pilotage des enchères B2B — Sessions & Lots / Accès
 * Revendeurs / Résultats & Facturation. La RLS (0104/0105) autorise déjà
 * les admins en écriture totale sur les 4 tables ; les deux seules actions
 * qui passent par une RPC dédiée sont la clôture (classement adjugé/non
 * vendu, voir admin_close_auction_session) et la génération de commande. */
export const AuctionsAdmin: React.FC = () => {
  const { isAdmin } = useAdminAuth();
  const [section, setSection] = useState<AdminAuctionSection>('sessions');
  const [successToast, setSuccessToast] = useState('');

  const { sessions, loading: sessionsLoading, error: sessionsError, createSession, setSessionStatus } = useAdminAuctionSessions(isAdmin);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [showSessionModal, setShowSessionModal] = useState(false);
  const [showItemModal, setShowItemModal] = useState(false);
  const [statusUpdatingId, setStatusUpdatingId] = useState<string | null>(null);

  const { items, loading: itemsLoading, error: itemsError, addItem, removeItem, generateOrder } = useAdminAuctionItems(selectedSessionId);
  const { grants, loading: grantsLoading, error: grantsError, grantAccess } = useAdminAuctionAccess(isAdmin);
  const [showGrantModal, setShowGrantModal] = useState(false);
  const [generatingId, setGeneratingId] = useState<string | null>(null);

  const selectedSession = useMemo(() => sessions.find((s) => s.id === selectedSessionId) || null, [sessions, selectedSessionId]);
  const closedSessions = useMemo(() => sessions.filter((s) => s.status === 'closed'), [sessions]);
  const [resultsSessionId, setResultsSessionId] = useState<string | null>(null);
  const resultsSession = useMemo(() => closedSessions.find((s) => s.id === resultsSessionId) || closedSessions[0] || null, [closedSessions, resultsSessionId]);
  const { items: resultsItems, loading: resultsLoading } = useAdminAuctionItems(resultsSession?.id || null);

  const handleSessionStatusChange = async (id: string, status: AuctionSession['status']) => {
    setStatusUpdatingId(id);
    const result = await setSessionStatus(id, status);
    setStatusUpdatingId(null);
    if (result.success) setSuccessToast(status === 'live' ? 'Session lancée en direct.' : 'Session clôturée — lots classés.');
  };

  const handleGenerateOrder = async (itemId: string) => {
    setGeneratingId(itemId);
    const result = await generateOrder(itemId);
    setGeneratingId(null);
    if (result.success) setSuccessToast(`Commande ${result.orderNumber || ''} générée avec succès.`);
    else alert(result.error || 'Erreur lors de la génération de la commande');
  };

  const SECTIONS: { id: AdminAuctionSection; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'sessions', label: 'Sessions & Lots', icon: Gavel },
    { id: 'access', label: 'Accès Revendeurs', icon: Ticket },
    { id: 'results', label: 'Résultats & Facturation', icon: Receipt },
  ];

  return (
    <div className="p-4 md:p-6">
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <Gavel className="h-5 w-5" />
          Enchères B2B
        </h3>
        <p className="text-sm text-gray-500">Pilotage des sessions hebdomadaires, des lots et des accès revendeurs</p>
      </div>

      <div className="flex items-center gap-1 mb-6 border-b border-gray-200 overflow-x-auto">
        {SECTIONS.map((s) => {
          const Icon = s.icon;
          const active = section === s.id;
          return (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                active ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <Icon className="h-4 w-4" />
              {s.label}
            </button>
          );
        })}
      </div>

      {section === 'sessions' && (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          <div className="lg:col-span-2 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-gray-900">Sessions ({sessions.length})</p>
              <button
                onClick={() => setShowSessionModal(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors text-xs font-medium"
              >
                <Plus className="h-3.5 w-3.5" />
                Créer une session
              </button>
            </div>

            {sessionsError && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0" />
                <p className="text-sm text-red-700">{sessionsError}</p>
              </div>
            )}

            {sessionsLoading ? (
              [...Array(2)].map((_, i) => <div key={i} className="h-24 bg-gray-100 rounded-lg animate-pulse" />)
            ) : sessions.length === 0 ? (
              <div className="text-center py-10 border border-dashed border-gray-200 rounded-lg">
                <Gavel className="h-8 w-8 text-gray-300 mx-auto mb-2" />
                <p className="text-sm text-gray-500">Aucune session pour l'instant.</p>
              </div>
            ) : (
              sessions.map((s) => (
                <Card
                  key={s.id}
                  hover
                  onClick={() => setSelectedSessionId(s.id)}
                  className={`cursor-pointer ${selectedSessionId === s.id ? 'ring-2 ring-gray-900' : ''}`}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <p className="text-sm font-semibold text-gray-900">{s.title}</p>
                      {sessionStatusBadge(s.status)}
                    </div>
                    <p className="text-xs text-gray-500">
                      {new Date(s.starts_at).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} →{' '}
                      {new Date(s.ends_at).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </p>
                    <div className="flex items-center gap-2 mt-3" onClick={(e) => e.stopPropagation()}>
                      {s.status === 'upcoming' && (
                        <button
                          onClick={() => handleSessionStatusChange(s.id, 'live')}
                          disabled={statusUpdatingId === s.id}
                          className="flex items-center gap-1 px-2.5 py-1 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 text-xs font-medium"
                        >
                          <Zap className="h-3 w-3" />
                          Lancer en direct
                        </button>
                      )}
                      {s.status !== 'closed' && (
                        <button
                          onClick={() => {
                            if (window.confirm('Clôturer cette session ? Les lots seront classés adjugé/non vendu.')) handleSessionStatusChange(s.id, 'closed');
                          }}
                          disabled={statusUpdatingId === s.id}
                          className="flex items-center gap-1 px-2.5 py-1 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50 text-xs font-medium"
                        >
                          <CheckCircle2 className="h-3 w-3" />
                          Clôturer
                        </button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>

          <div className="lg:col-span-3">
            {!selectedSession ? (
              <div className="text-center py-16 border border-dashed border-gray-200 rounded-lg">
                <p className="text-sm text-gray-500">Sélectionne une session pour gérer ses lots.</p>
              </div>
            ) : (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm font-medium text-gray-900">Pièces de "{selectedSession.title}" ({items.length})</p>
                  <button
                    onClick={() => setShowItemModal(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors text-xs font-medium"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Ajouter une pièce
                  </button>
                </div>

                {itemsError && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-center gap-2 mb-3">
                    <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0" />
                    <p className="text-sm text-red-700">{itemsError}</p>
                  </div>
                )}

                <Card>
                  <CardContent className="p-0">
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b border-gray-100">
                            <th className="text-left py-2.5 px-3 font-medium text-gray-500 text-xs">Pièce</th>
                            <th className="text-right py-2.5 px-3 font-medium text-gray-500 text-xs">Départ → Actuel</th>
                            <th className="text-left py-2.5 px-3 font-medium text-gray-500 text-xs">Meilleur enchérisseur</th>
                            <th className="text-left py-2.5 px-3 font-medium text-gray-500 text-xs">Temps restant</th>
                            <th className="text-left py-2.5 px-3 font-medium text-gray-500 text-xs">Statut</th>
                            <th className="text-right py-2.5 px-3 font-medium text-gray-500 text-xs"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {itemsLoading ? (
                            <tr><td colSpan={6} className="py-6 text-center text-sm text-gray-400">Chargement...</td></tr>
                          ) : items.length === 0 ? (
                            <tr><td colSpan={6} className="py-6 text-center text-sm text-gray-500">Aucune pièce sur cette session.</td></tr>
                          ) : (
                            items.map((item) => {
                              const extended = new Date(item.ends_at).getTime() > new Date(selectedSession.ends_at).getTime();
                              return (
                                <tr key={item.id} className="border-b border-gray-50 last:border-b-0">
                                  <td className="py-2.5 px-3">
                                    <div className="flex items-center gap-2.5">
                                      <div className="h-9 w-9 bg-gray-100 rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden">
                                        {item.images?.[0] ? <img src={item.images[0]} alt="" className="h-full w-full object-cover" /> : <ImageOff className="h-4 w-4 text-gray-400" />}
                                      </div>
                                      <div className="min-w-0">
                                        <p className="text-sm font-medium text-gray-900 truncate max-w-[160px]">{item.title}</p>
                                        <p className="text-xs text-gray-500">{item.brand} · {item.grade}</p>
                                        {!item.product_id && <p className="text-xs text-amber-600">Sans fiche produit</p>}
                                      </div>
                                    </div>
                                  </td>
                                  <td className="py-2.5 px-3 text-right text-xs text-gray-600 tabular-nums">
                                    {EUR(item.start_price)} → <span className="font-semibold text-gray-900">{EUR(item.current_price)}</span>
                                  </td>
                                  <td className="py-2.5 px-3 text-xs text-gray-700">
                                    {item.winner_name ? (
                                      <>
                                        <p>{item.winner_name}</p>
                                        <p className="text-gray-400">{item.winner_email}</p>
                                      </>
                                    ) : '—'}
                                  </td>
                                  <td className="py-2.5 px-3">
                                    {item.status === 'active' ? (
                                      <div className="flex items-center gap-1.5">
                                        <AuctionCountdown endsAt={item.ends_at} />
                                        {extended && <span title="Prolongation anti-snipe"><Clock className="h-3.5 w-3.5 text-amber-500" /></span>}
                                      </div>
                                    ) : '—'}
                                  </td>
                                  <td className="py-2.5 px-3">{itemStatusBadge(item.status)}</td>
                                  <td className="py-2.5 px-3 text-right">
                                    {item.status === 'active' && item.current_price === item.start_price && (
                                      <button
                                        onClick={() => removeItem(item.id)}
                                        className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                        title="Retirer ce lot (aucune enchère posée)"
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </button>
                                    )}
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
          </div>
        </div>
      )}

      {section === 'access' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm font-medium text-gray-900">Pass & abonnements ({grants.length})</p>
            <button
              onClick={() => setShowGrantModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors text-xs font-medium"
            >
              <Ticket className="h-3.5 w-3.5" />
              Offrir un accès
            </button>
          </div>

          {grantsError && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-center gap-2 mb-3">
              <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0" />
              <p className="text-sm text-red-700">{grantsError}</p>
            </div>
          )}

          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="text-left py-3 px-4 font-medium text-gray-900 text-sm">Revendeur</th>
                      <th className="text-left py-3 px-4 font-medium text-gray-900 text-sm">Type</th>
                      <th className="text-left py-3 px-4 font-medium text-gray-900 text-sm">Session</th>
                      <th className="text-left py-3 px-4 font-medium text-gray-900 text-sm">Valide jusqu'au</th>
                      <th className="text-right py-3 px-4 font-medium text-gray-900 text-sm">Montant payé</th>
                    </tr>
                  </thead>
                  <tbody>
                    {grantsLoading ? (
                      <tr><td colSpan={5} className="py-6 text-center text-sm text-gray-400">Chargement...</td></tr>
                    ) : grants.length === 0 ? (
                      <tr><td colSpan={5} className="py-6 text-center text-sm text-gray-500">Aucun accès attribué pour l'instant.</td></tr>
                    ) : (
                      grants.map((g) => (
                        <tr key={g.id} className="border-b border-gray-50 hover:bg-gray-50">
                          <td className="py-3 px-4 text-sm text-gray-900">
                            <p className="font-medium">{g.requester_name}</p>
                            <p className="text-xs text-gray-500">{g.company_name}</p>
                          </td>
                          <td className="py-3 px-4">
                            <Badge variant="info">{g.access_type === 'weekly_pass' ? 'Pass session' : 'Abonné mensuel'}</Badge>
                          </td>
                          <td className="py-3 px-4 text-sm text-gray-600">{g.session_title || '—'}</td>
                          <td className="py-3 px-4 text-sm text-gray-600">{new Date(g.valid_until).toLocaleDateString('fr-FR')}</td>
                          <td className="py-3 px-4 text-right text-sm text-gray-900 tabular-nums">{g.price_paid > 0 ? EUR(g.price_paid) : 'Offert'}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {section === 'results' && (
        <div>
          <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
            <p className="text-sm font-medium text-gray-900">Résultats de session</p>
            <select
              value={resultsSession?.id || ''}
              onChange={(e) => setResultsSessionId(e.target.value)}
              className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm bg-white"
            >
              {closedSessions.length === 0 ? (
                <option value="">Aucune session clôturée</option>
              ) : (
                closedSessions.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)
              )}
            </select>
          </div>

          {!resultsSession ? (
            <div className="text-center py-16 border border-dashed border-gray-200 rounded-lg">
              <Trophy className="h-10 w-10 text-gray-300 mx-auto mb-3" />
              <p className="text-sm text-gray-500">Aucune session clôturée pour l'instant.</p>
            </div>
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-gray-100">
                        <th className="text-left py-2.5 px-3 font-medium text-gray-500 text-xs">Pièce</th>
                        <th className="text-left py-2.5 px-3 font-medium text-gray-500 text-xs">Résultat</th>
                        <th className="text-left py-2.5 px-3 font-medium text-gray-500 text-xs">Gagnant</th>
                        <th className="text-right py-2.5 px-3 font-medium text-gray-500 text-xs">Montant final</th>
                        <th className="text-right py-2.5 px-3 font-medium text-gray-500 text-xs"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {resultsLoading ? (
                        <tr><td colSpan={5} className="py-6 text-center text-sm text-gray-400">Chargement...</td></tr>
                      ) : resultsItems.length === 0 ? (
                        <tr><td colSpan={5} className="py-6 text-center text-sm text-gray-500">Aucune pièce sur cette session.</td></tr>
                      ) : (
                        resultsItems.map((item) => (
                          <tr key={item.id} className="border-b border-gray-50 last:border-b-0">
                            <td className="py-2.5 px-3">
                              <p className="text-sm font-medium text-gray-900">{item.title}</p>
                              <p className="text-xs text-gray-500">{item.brand}</p>
                            </td>
                            <td className="py-2.5 px-3">
                              {item.status === 'sold' ? (
                                <Badge variant="success">Adjugé</Badge>
                              ) : (
                                <Badge variant="warning">
                                  {item.current_winner_id ? 'Non vendu (réserve non atteinte)' : 'Non vendu (aucune enchère)'}
                                </Badge>
                              )}
                            </td>
                            <td className="py-2.5 px-3 text-sm text-gray-700">
                              {item.winner_name ? `${item.winner_name}${item.status === 'unsold' ? ' (meilleure offre)' : ''}` : '—'}
                            </td>
                            <td className="py-2.5 px-3 text-right text-sm font-semibold text-gray-900 tabular-nums">{EUR(item.current_price)}</td>
                            <td className="py-2.5 px-3 text-right">
                              {item.status === 'sold' && (
                                <button
                                  onClick={() => handleGenerateOrder(item.id)}
                                  disabled={generatingId === item.id}
                                  title={!item.product_id ? "Lier une fiche produit à ce lot avant de générer la commande" : undefined}
                                  className="px-3 py-1.5 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50 text-xs font-medium"
                                >
                                  {generatingId === item.id ? 'Génération...' : 'Générer la commande'}
                                </button>
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      <AuctionSessionFormModal isOpen={showSessionModal} onClose={() => setShowSessionModal(false)} onSubmit={createSession} />

      <AuctionItemFormModal
        isOpen={showItemModal}
        onClose={() => setShowItemModal(false)}
        onSubmit={async (input, productId) => {
          if (!selectedSession) return { success: false, error: 'Session inconnue' };
          return addItem(selectedSession.ends_at, input, productId);
        }}
      />

      <GrantAuctionAccessModal
        isOpen={showGrantModal}
        onClose={() => setShowGrantModal(false)}
        sessions={sessions}
        onGrant={grantAccess}
      />

      {successToast && <Toast message={successToast} onDismiss={() => setSuccessToast('')} />}
    </div>
  );
};

export default AuctionsAdmin;
