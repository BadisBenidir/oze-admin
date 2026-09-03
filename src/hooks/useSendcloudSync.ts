import { invokeEdgeFunction } from '../utils/invokeEdgeFunction';

interface SendcloudSyncResult {
  success: boolean;
  checked?: number;
  updated?: number;
  errors?: Array<{ tracking_number: string; error: string }>;
  error?: string;
}

/**
 * Filet de secours tant que sendcloud-webhook n'est pas configuré côté
 * dashboard Sendcloud (ou pour rattraper un événement manqué) : interroge
 * Sendcloud en direct pour les colis pas encore livrés et fait avancer leur
 * statut réel (label_created -> shipped -> delivered) — voir
 * sendcloud-sync-tracking/index.ts.
 */
export const useSendcloudSync = () => {
  const sync = async (shipmentId?: string): Promise<SendcloudSyncResult> => {
    const { data, error } = await invokeEdgeFunction<SendcloudSyncResult>('sendcloud-sync-tracking', {
      ...(shipmentId ? { shipment_id: shipmentId } : {}),
    });
    if (error) return { success: false, error };
    return { success: true, checked: data?.checked, updated: data?.updated, errors: data?.errors };
  };

  return { sync };
};
