import React from 'react';
import { Zap } from 'lucide-react';

const NAVY = '#0F172A';
const GOLD = '#E9C46A';

/**
 * Article déjà reçu dans nos locaux (products.received_at, 0240 / 0306) :
 * la livraison peut être demandée dès l'achat, réception en 2 à 4 jours.
 * Pastille navy (couleur du site), éclair or. `overlay` : sur la photo d'une
 * carte ; sinon encadré pour la fiche.
 */
export const AvailableForDeliveryBadge: React.FC<{ variant?: 'overlay' | 'block' }> = ({ variant = 'overlay' }) =>
  variant === 'overlay' ? (
    <span
      title="Déjà dans nos locaux : livraison demandable dès l'achat, reçu en 2 à 4 jours"
      style={{ backgroundColor: NAVY }}
      className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium text-white shadow-sm"
    >
      <Zap className="h-3.5 w-3.5" style={{ color: GOLD }} strokeWidth={2.25} />
      Livraison disponible
    </span>
  ) : (
    <div style={{ backgroundColor: NAVY }} className="flex items-start gap-3 rounded-lg px-4 py-3 text-sm text-white">
      <Zap className="mt-0.5 h-4 w-4 flex-shrink-0" style={{ color: GOLD }} strokeWidth={2.25} />
      <div>
        <p className="font-semibold">Livraison disponible</p>
        <p className="text-white/75">Déjà dans nos locaux : demandez la livraison dès l'achat, reçu en 2 à 4 jours.</p>
      </div>
    </div>
  );
