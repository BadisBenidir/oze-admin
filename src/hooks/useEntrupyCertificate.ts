import { invokeEdgeFunction } from '../utils/invokeEdgeFunction';

interface RequestCertificateResult {
  success: boolean;
  url?: string;
  error?: string;
}

/**
 * Ajout POST-ACHAT du certificat d'authenticité Entrupy (19,99 €/pièce) sur
 * un ou plusieurs order_items déjà existants. Ne modifie rien en base ici :
 * ouvre une session Stripe et renvoie son URL de redirection — l'article
 * n'est réellement marqué certifié qu'après paiement confirmé, via
 * b2b-stripe-webhook + finalize_entrupy_certificate_request. Même pattern
 * que useReadyToShipItems.requestDelivery pour la demande de livraison.
 */
export const useEntrupyCertificate = () => {
  const requestCertificate = async (itemIds: string[]): Promise<RequestCertificateResult> => {
    const { data, error } = await invokeEdgeFunction<{ url?: string }>('b2b-request-entrupy-certificate', {
      item_ids: itemIds,
    });

    if (error) {
      return { success: false, error };
    }
    if (!data?.url) {
      return { success: false, error: 'Réponse de paiement invalide' };
    }

    return { success: true, url: data.url };
  };

  return { requestCertificate };
};
