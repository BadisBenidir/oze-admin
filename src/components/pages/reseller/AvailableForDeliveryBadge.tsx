import React from 'react';
import { Truck } from 'lucide-react';

/**
 * Article déjà reçu dans nos locaux (products.received_at, 0240 / 0306) :
 * la livraison peut être demandée dès l'achat, réception en 2 à 4 jours.
 * `overlay` : pastille sur la photo d'une carte ; sinon encadré pour la fiche.
 */
export const AvailableForDeliveryBadge: React.FC<{ variant?: 'overlay' | 'block' }> = ({ variant = 'overlay' }) =>
  variant === 'overlay' ? (
    <span
      title="Déjà dans nos locaux : livraison demandable dès l'achat, reçu en 2 à 4 jours"
      className="flex items-center gap-1 rounded-full bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm"
    >
      <Truck className="h-3 w-3" />
      Dispo à la livraison
    </span>
  ) : (
    <div className="flex items-start gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-900">
      <Truck className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-700" />
      <div>
        <p className="font-semibold">Disponible à la livraison</p>
        <p className="text-emerald-800">
          Déjà dans nos locaux : vous pouvez demander la livraison dès l'achat, reçu en 2 à 4 jours.
        </p>
      </div>
    </div>
  );
