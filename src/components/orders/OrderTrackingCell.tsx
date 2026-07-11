import React, { useState } from 'react';
import { Copy, Check, ExternalLink, Truck } from 'lucide-react';

interface TrackingShippingAddress {
  postcode?: string | null;
  pickup_point_zip?: string | null;
  pickup_point_network?: string | null;
}

interface OrderTrackingCellProps {
  /** Numéro de suivi transporteur (orders.tracking_number) */
  trackingNumber?: string | null;
  /** URL de suivi « clé en main » Sendcloud (orders.tracking_url) : redirige vers le bon transporteur. */
  trackingUrl?: string | null;
  /** Adresse de livraison (orders.shipping_address) : sert à déduire le transporteur / le code postal. */
  shippingAddress?: TrackingShippingAddress | null;
}

type CarrierCode = 'mondial_relay' | 'colissimo';

/** Déduit le transporteur depuis le réseau du point relais, sinon le préfixe « MR… » du suivi. */
const getCarrier = (
  trackingNumber?: string | null,
  shippingAddress?: TrackingShippingAddress | null,
): CarrierCode => {
  const network = String(shippingAddress?.pickup_point_network || '').toLowerCase();
  if (network.includes('mondial')) return 'mondial_relay';
  if (String(trackingNumber || '').toUpperCase().startsWith('MR')) return 'mondial_relay';
  return 'colissimo';
};

const carrierLabel = (c: CarrierCode) => (c === 'mondial_relay' ? 'Mondial Relay' : 'Colissimo');

/**
 * URL de suivi DYNAMIQUE selon le transporteur renvoyé par Sendcloud.
 *
 * Privilégie l'URL « clé en main » (`tracking_url`) qui redirige vers la bonne page
 * transporteur ; à défaut, reconstruit le lien. Mondial Relay attend le n° d'expédition
 * SANS le préfixe « MR » + le code postal de destination (sinon « aucun colis identifié »).
 */
const buildTrackingUrl = (
  trackingNumber: string,
  trackingUrl?: string | null,
  shippingAddress?: TrackingShippingAddress | null,
): string => {
  if (trackingUrl) return trackingUrl;
  if (getCarrier(trackingNumber, shippingAddress) === 'mondial_relay') {
    const expedition = trackingNumber.replace(/\D/g, '') || trackingNumber;
    const cp = shippingAddress?.postcode || shippingAddress?.pickup_point_zip || '';
    const base = `https://www.mondialrelay.fr/suivi-de-colis/?numeroExpedition=${encodeURIComponent(expedition)}`;
    return cp ? `${base}&codePostal=${encodeURIComponent(cp)}` : base;
  }
  return `https://www.laposte.fr/outils/suivre-vos-envois?code=${encodeURIComponent(trackingNumber)}`;
};

/**
 * Cellule « Suivi » pour le grand tableau des commandes.
 *
 * Affiche le numéro de suivi cliquable (ouvre la page du bon transporteur,
 * Colissimo OU Mondial Relay) accompagné d'un bouton « copier ». Si aucun numéro
 * n'est disponible, affiche un tiret discret.
 */
export const OrderTrackingCell: React.FC<OrderTrackingCellProps> = ({
  trackingNumber,
  trackingUrl,
  shippingAddress,
}) => {
  const [copied, setCopied] = useState(false);

  if (!trackingNumber) {
    return <span className="text-sm text-gray-400">—</span>;
  }

  const carrier = getCarrier(trackingNumber, shippingAddress);
  const href = buildTrackingUrl(trackingNumber, trackingUrl, shippingAddress);

  const handleCopy = async (e: React.MouseEvent) => {
    // Évite de déclencher d'éventuels handlers de la ligne (ex: ouverture du détail).
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(trackingNumber);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Impossible de copier le numéro de suivi:', err);
    }
  };

  return (
    <div className="flex items-center space-x-2">
      <Truck className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="group inline-flex items-center space-x-1 font-mono text-xs md:text-sm text-blue-600 hover:text-blue-800 hover:underline"
        title={`Suivre le colis sur ${carrierLabel(carrier)}`}
      >
        <span>{trackingNumber}</span>
        <ExternalLink className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
      </a>
      <button
        onClick={handleCopy}
        className="p-1 text-gray-400 hover:text-gray-700 transition-colors"
        title={copied ? 'Copié !' : 'Copier le numéro de suivi'}
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-green-600" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
      </button>
    </div>
  );
};