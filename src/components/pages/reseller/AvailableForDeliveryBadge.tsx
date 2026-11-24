import React from 'react';

/** Point vert « en stock », discret. */
const Dot: React.FC<{ className?: string }> = ({ className = '' }) => (
  <span className={`relative flex h-2.5 w-2.5 flex-shrink-0 ${className}`}>
    <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-50 motion-safe:animate-ping" />
    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
  </span>
);

/**
 * Article déjà reçu dans nos locaux (products.received_at, 0240 / 0306) :
 * la livraison peut être demandée dès l'achat, réception en 2 à 4 jours.
 * `overlay` : pastille sur la photo d'une carte (même style que « État B ») ;
 * sinon encadré pour la fiche.
 */
export const AvailableForDeliveryBadge: React.FC<{ variant?: 'overlay' | 'block' }> = ({ variant = 'overlay' }) =>
  variant === 'overlay' ? (
    <span
      title="Déjà dans nos locaux : livraison demandable dès l'achat, reçu en 2 à 4 jours"
      className="flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-[13px] font-bold text-emerald-700 shadow-md"
    >
      <Dot />
      Dispo à la livraison
    </span>
  ) : (
    <div className="flex items-start gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm">
      <Dot className="mt-1.5" />
      <div>
        <p className="font-bold text-emerald-700">Disponible à la livraison</p>
        <p className="text-gray-600">Déjà dans nos locaux : demandez la livraison dès l'achat, reçu en 2 à 4 jours.</p>
      </div>
    </div>
  );
