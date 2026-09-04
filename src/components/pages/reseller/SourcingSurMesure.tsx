import React, { useState } from 'react';
import { Card, CardContent } from '../../ui/Card';
import { Badge } from '../../ui/Badge';
import { Toast } from '../../ui/Toast';
import { useResellerAuth } from '../../../hooks/useResellerAuth';
import { useResellerSourcing, ResellerSourcingItem, ResellerSourcingMission } from '../../../hooks/useResellerSourcing';
import { SourcingItemDetailModal } from './SourcingItemDetailModal';
import { AlertCircle, PackageSearch, ImageOff, Sparkles, CheckCircle2 } from 'lucide-react';

const missionStatusBadge = (status: ResellerSourcingMission['status']) => {
  if (status === 'completed') return <Badge variant="success">Prêt</Badge>;
  return <Badge variant="info">Sourcing en cours par l'équipe OZË Paris</Badge>;
};

const itemStatusBadge = (status: ResellerSourcingItem['status']) => {
  switch (status) {
    case 'validated':
      return <Badge variant="info">Validée</Badge>;
    case 'shipped':
      return <Badge variant="success">Expédiée</Badge>;
    default:
      return <Badge variant="default">Sourcé / Prévu dans votre lot</Badge>;
  }
};

/** Portail revendeur "Sourcing sur mesure". La mission (titre, avance,
 * statut) est toujours visible dès qu'elle existe pour l'entreprise/le
 * profil du revendeur connecté — seule la galerie de pièces reste
 * conditionnée à is_published_to_reseller (basculé côté admin via
 * SourcingMissionDetailModal.tsx). Jamais de marge ni de coût d'achat ici :
 * useResellerSourcing ne lit que des vues qui les excluent structurellement
 * — voir 0094/0095_b2b_sourcing_reseller_portal*.sql. */
export const SourcingSurMesure: React.FC = () => {
  const { isReseller } = useResellerAuth();
  // Une mission annulée n'a jamais réellement été livrée au client — déjà
  // exclue par reseller_sourcing_missions, filtre redondant en défense en
  // profondeur (même principe que useMyShipments.ts).
  const { missions: allMissions, loading, error, validateMission } = useResellerSourcing(isReseller);
  const missions = allMissions.filter((m) => m.status !== 'cancelled');
  const [viewingItem, setViewingItem] = useState<ResellerSourcingItem | null>(null);
  const [confirmingMissionId, setConfirmingMissionId] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const [validationError, setValidationError] = useState('');
  const [successToast, setSuccessToast] = useState('');

  const handleConfirmValidate = async () => {
    if (!confirmingMissionId) return;
    setValidating(true);
    setValidationError('');
    const result = await validateMission(confirmingMissionId);
    setValidating(false);
    if (!result.success) {
      setValidationError(result.error || 'Erreur lors de la validation');
      return;
    }
    setConfirmingMissionId(null);
    setSuccessToast('Votre sélection a été validée — les pièces rejoindront votre prochaine expédition.');
  };

  return (
    <div className="p-4 md:p-6">
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-gray-900">Sourcing sur mesure</h3>
        <p className="text-sm text-gray-500">Suivi des pièces sourcées à votre demande par l'équipe OZË Paris</p>
      </div>

      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 flex items-center space-x-3">
          <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0" />
          <p className="text-sm text-red-700">Erreur : {error}</p>
        </div>
      )}

      {loading && (
        <div className="space-y-4">
          {[...Array(2)].map((_, i) => <div key={i} className="h-28 bg-gray-100 rounded-lg animate-pulse" />)}
        </div>
      )}

      {!loading && !error && missions.length === 0 && (
        <div className="text-center py-16 border border-dashed border-gray-200 rounded-lg">
          <PackageSearch className="h-10 w-10 text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-500">Aucun sourcing sur mesure actif pour le moment.</p>
        </div>
      )}

      <div className="space-y-6">
        {missions.map((mission) => (
          <div key={mission.id}>
            <Card className="mb-4">
              <CardContent className="p-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <p className="text-base font-semibold text-gray-900">{mission.title}</p>
                    {mission.reference && <p className="text-xs text-gray-400 font-mono">{mission.reference}</p>}
                    <p className="text-xs text-gray-500 mt-0.5">
                      Avance versée / Budget confié : <span className="font-medium text-gray-700">{mission.advance_amount.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €</span>
                      {mission.paid_at && <> · le {new Date(mission.paid_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })}</>}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {missionStatusBadge(mission.status)}
                    {mission.status === 'active' && mission.is_published_to_reseller && mission.items.length > 0 && (
                      <button
                        onClick={() => { setValidationError(''); setConfirmingMissionId(mission.id); }}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors text-xs font-medium"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Valider ma sélection
                      </button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            {!mission.is_published_to_reseller ? (
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-6 text-center">
                <Sparkles className="h-8 w-8 text-gray-300 mx-auto mb-3" />
                <p className="text-sm text-gray-600 max-w-md mx-auto">
                  Votre sourcing est actuellement entre les mains de notre équipe. Les pièces sélectionnées seront dévoilées ici dès que la sélection sera validée.
                </p>
              </div>
            ) : mission.items.length === 0 ? (
              <p className="text-sm text-gray-400 italic px-1">Notre équipe est en train de sélectionner vos premières pièces.</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                {mission.items.map((item) => {
                  const photo = item.photos?.[0];
                  return (
                    <Card
                      key={item.id}
                      hover
                      onClick={() => setViewingItem(item)}
                      className="overflow-hidden flex flex-col cursor-pointer"
                    >
                      <div className="relative h-40 bg-gray-100 flex items-center justify-center overflow-hidden">
                        {photo ? (
                          <img src={photo} alt={item.title} className="w-full h-full object-cover" />
                        ) : (
                          <ImageOff className="h-8 w-8 text-gray-300" />
                        )}
                      </div>
                      <CardContent className="p-3 flex-1 flex flex-col">
                        {item.brand && <p className="text-xs text-gray-500 mb-1">{item.brand}</p>}
                        <p className="text-sm font-medium text-gray-900 line-clamp-2 mb-2">{item.title}</p>
                        <div className="mt-auto">{itemStatusBadge(item.status)}</div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>

      <SourcingItemDetailModal item={viewingItem} onClose={() => setViewingItem(null)} />

      {confirmingMissionId && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="fixed inset-0 bg-black bg-opacity-40" onClick={() => !validating && setConfirmingMissionId(null)} />
          <div className="flex min-h-full items-center justify-center p-4">
            <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-base font-semibold text-gray-900">Valider votre sélection ?</h3>
              <p className="text-sm text-gray-600 mt-2">
                Cette sélection sera définitivement validée et rejoindra le circuit d'expédition standard, comme une commande classique. Vous ne pourrez plus modifier les pièces sélectionnées après validation.
              </p>
              {validationError && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-center space-x-2 mt-3">
                  <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0" />
                  <p className="text-sm text-red-700">{validationError}</p>
                </div>
              )}
              <div className="flex justify-end space-x-3 mt-5">
                <button
                  type="button"
                  onClick={() => setConfirmingMissionId(null)}
                  disabled={validating}
                  className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors text-sm disabled:opacity-50"
                >
                  Retour
                </button>
                <button
                  type="button"
                  onClick={handleConfirmValidate}
                  disabled={validating}
                  className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors text-sm font-medium disabled:opacity-50"
                >
                  {validating ? 'Validation...' : 'Oui, valider ma sélection'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {successToast && <Toast message={successToast} onDismiss={() => setSuccessToast('')} />}
    </div>
  );
};

export default SourcingSurMesure;
