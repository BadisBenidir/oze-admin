import { invokeEdgeFunction } from '../utils/invokeEdgeFunction';

export interface ParcelInput {
  item_ids: string[];
  weight_kg?: number;
}

export type CarrierOverride = 'mondial_relay' | 'colissimo';

export interface ParcelResult {
  parcel_index: number;
  item_ids: string[];
  status: 'label_created' | 'failed';
  /** Transporteur réellement utilisé pour ce colis (auto-détecté ou forcé
   * via carrierOverride) — voir generate-b2b-shipment-labels/index.ts. */
  carrier?: CarrierOverride;
  tracking_number?: string | null;
  tracking_url?: string | null;
  label_url?: string | null;
  error?: string;
}

interface GenerateResult {
  success: boolean;
  error?: string;
  shipment_status?: string;
  parcels?: ParcelResult[];
}

/** Appelle generate-b2b-shipment-labels : 1 appel Sendcloud par colis configuré. */
export const useGenerateShipmentLabels = () => {
  const generate = async (
    shipmentId: string,
    parcels: ParcelInput[],
    phoneOverride?: string,
    carrierOverride?: CarrierOverride
  ): Promise<GenerateResult> => {
    const { data, error } = await invokeEdgeFunction<{ success: boolean; shipment_status: string; parcels: ParcelResult[] }>(
      'generate-b2b-shipment-labels',
      {
        shipment_id: shipmentId,
        parcels,
        ...(phoneOverride ? { phone_override: phoneOverride } : {}),
        ...(carrierOverride ? { carrier_override: carrierOverride } : {}),
      }
    );
    if (error) return { success: false, error };
    return { success: true, shipment_status: data?.shipment_status, parcels: data?.parcels || [] };
  };

  return { generate };
};
