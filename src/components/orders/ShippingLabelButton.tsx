import React from 'react';
import { Printer } from 'lucide-react';

interface ShippingLabelButtonProps {
  /** ID de la commande (orders.id) */
  orderId: string;
  /** URL de l'étiquette déjà générée (info d'affichage uniquement). */
  labelUrl?: string | null;
  /** Conservé pour compatibilité ; non utilisé (la création se fait côté serveur). */
  onLabelCreated?: (data: {
    label_url: string;
    tracking_number: string | null;
    sendcloud_parcel_id: string | null;
  }) => void;
}

/**
 * Bouton « Imprimer l'étiquette ».
 *
 * Ouvre l'Edge Function `sendcloud-label` qui :
 *  - récupère le PDF de l'étiquette Sendcloud (auth Basic côté serveur), ou
 *  - crée le colis à la demande s'il n'existe pas encore, puis renvoie le PDF.
 *
 * Le PDF s'ouvre dans un nouvel onglet, prêt à imprimer.
 */
export const ShippingLabelButton: React.FC<ShippingLabelButtonProps> = ({ orderId, labelUrl }) => {
  const baseUrl = import.meta.env.VITE_SUPABASE_URL;

  const openLabel = () => {
    window.open(
      `${baseUrl}/functions/v1/sendcloud-label?order_id=${encodeURIComponent(orderId)}`,
      '_blank',
      'noopener,noreferrer',
    );
  };

  return (
    <div className="flex flex-col items-stretch space-y-1">
      <button
        onClick={openLabel}
        className="flex items-center justify-center space-x-2 px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors"
      >
        <Printer className="h-4 w-4" />
        <span>{labelUrl ? "Imprimer l'étiquette" : "Générer & imprimer l'étiquette"}</span>
      </button>
      <p className="text-xs text-gray-400 text-center">
        Le PDF s'ouvre dans un nouvel onglet.
      </p>
    </div>
  );
};