import { invokeEdgeFunction } from '../utils/invokeEdgeFunction';

interface SendcloudSyncRoundResult {
  success: boolean;
  checked?: number;
  updated?: number;
  errors?: Array<{ tracking_number: string; error: string }>;
  has_more?: boolean;
  error?: string;
}

export interface SendcloudSyncResult {
  success: boolean;
  checked: number;
  updated: number;
  errors: Array<{ tracking_number: string; error: string }>;
  /** true si le plafond de sécurité (MAX_ROUNDS) a été atteint avant d'avoir
   * traité tout l'arriéré — relancer suffit pour continuer. */
  incomplete: boolean;
  error?: string;
}

// Un lot de colis label_created/shipped réellement vérifiés en un seul clic
// (voir has_more côté sendcloud-sync-tracking/index.ts, dont chaque appel se
// limite déjà à ~100 colis et ~100s pour rester sous la limite d'exécution
// d'une edge function). 30 tours à 100 colis chacun = 3000 colis d'arriéré
// couverts en un clic, largement au-delà de tout arriéré réaliste ; un
// plafond reste nécessaire pour ne jamais boucler indéfiniment dans le
// navigateur si has_more restait vrai à tort (bug serveur).
const MAX_ROUNDS = 30;

/**
 * Filet de secours tant que sendcloud-webhook n'est pas configuré côté
 * dashboard Sendcloud (ou pour rattraper un arriéré de colis déjà livrés
 * avant sa mise en place) : interroge Sendcloud en direct pour les colis pas
 * encore livrés et fait avancer leur statut réel (label_created -> shipped ->
 * delivered) — voir sendcloud-sync-tracking/index.ts.
 *
 * `sync(shipmentId)` cible un seul shipment (bouton dans une demande de
 * livraison/commande/fiche produit) ; `sync()` sans argument balaie TOUT
 * l'arriéré global — en interne, plusieurs appels successifs à l'edge
 * function tant qu'elle signale `has_more`, pour donner l'expérience "un
 * seul clic" côté admin même sur un gros arriéré, sans jamais envoyer une
 * seule requête assez longue pour risquer un timeout.
 */
export const useSendcloudSync = () => {
  const sync = async (
    shipmentId?: string,
    onProgress?: (progress: { checked: number; updated: number }) => void
  ): Promise<SendcloudSyncResult> => {
    let totalChecked = 0;
    let totalUpdated = 0;
    const allErrors: Array<{ tracking_number: string; error: string }> = [];

    for (let round = 0; round < MAX_ROUNDS; round++) {
      const { data, error } = await invokeEdgeFunction<SendcloudSyncRoundResult>('sendcloud-sync-tracking', {
        ...(shipmentId ? { shipment_id: shipmentId } : {}),
      });

      if (error) {
        return { success: false, checked: totalChecked, updated: totalUpdated, errors: allErrors, incomplete: false, error };
      }

      totalChecked += data?.checked || 0;
      totalUpdated += data?.updated || 0;
      allErrors.push(...(data?.errors || []));
      onProgress?.({ checked: totalChecked, updated: totalUpdated });

      // Un lot vide ou incomplet (moins que le plafond serveur, et pas coupé
      // par son propre budget de temps) signifie qu'il n'y a plus rien à
      // traiter pour l'instant.
      if (!data?.has_more) {
        return { success: true, checked: totalChecked, updated: totalUpdated, errors: allErrors, incomplete: false };
      }
    }

    return { success: true, checked: totalChecked, updated: totalUpdated, errors: allErrors, incomplete: true };
  };

  return { sync };
};
