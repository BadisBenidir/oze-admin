import React from 'react';
import type { OrderWithItems } from '../../services/orderService';

/** Statuts d'expédition dérivés de l'état d'une commande. */
export type ShipmentStatus = 'all' | 'to_ship' | 'label_created' | 'shipped' | 'delivered';

/**
 * Dérive le statut d'expédition d'une commande à partir de son `status`
 * et de la présence d'une étiquette Sendcloud.
 *
 *  - to_ship       : payée/confirmée, pas encore d'étiquette
 *  - label_created : étiquette générée mais colis pas encore marqué expédié
 *  - shipped       : expédiée
 *  - delivered     : livrée
 */
export const getShipmentStatus = (order: OrderWithItems): Exclude<ShipmentStatus, 'all'> => {
  if (order.status === 'delivered') return 'delivered';
  if (order.status === 'shipped') return 'shipped';
  if (order.label_url) return 'label_created';
  return 'to_ship';
};

const FILTERS: { value: ShipmentStatus; label: string }[] = [
  { value: 'all', label: 'Toutes' },
  { value: 'to_ship', label: 'À expédier' },
  { value: 'label_created', label: 'Étiquette créée' },
  { value: 'shipped', label: 'Expédiées' },
  { value: 'delivered', label: 'Livrées' },
];

interface ShipmentStatusFilterProps {
  value: ShipmentStatus;
  onChange: (value: ShipmentStatus) => void;
  /** Compteurs optionnels par statut, affichés en pastille. */
  counts?: Partial<Record<ShipmentStatus, number>>;
}

/**
 * Barre de filtres (pills) par statut d'expédition pour la liste des commandes.
 */
export const ShipmentStatusFilter: React.FC<ShipmentStatusFilterProps> = ({
  value,
  onChange,
  counts,
}) => {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {FILTERS.map((filter) => {
        const isActive = value === filter.value;
        const count = counts?.[filter.value];
        return (
          <button
            key={filter.value}
            onClick={() => onChange(filter.value)}
            className={`inline-flex items-center space-x-2 px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
              isActive
                ? 'bg-gray-900 text-white border-gray-900'
                : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
            }`}
          >
            <span>{filter.label}</span>
            {typeof count === 'number' && (
              <span
                className={`inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded-full text-xs ${
                  isActive ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-600'
                }`}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};