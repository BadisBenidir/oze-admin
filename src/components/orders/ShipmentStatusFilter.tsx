import React from 'react';
import type { OrderWithItems } from '../../services/orderService';
import { FULFILLMENT_RANK } from '../../hooks/useB2BOrders';

/** Statuts d'expédition dérivés de l'état d'une commande. 'other' regroupe
 * tout ce qui n'exige aucune action logistique immédiate (en attente de
 * paiement, annulée, achetée B2B mais pas encore demandée en livraison...) —
 * jamais compté dans "à expédier", visible seulement sous "Toutes". */
export type ShipmentStatus = 'all' | 'to_ship' | 'label_created' | 'shipped' | 'delivered' | 'other';

/**
 * Dérive le statut d'expédition d'une commande — deux logiques bien
 * distinctes selon le canal, jamais mélangées :
 *
 *  - Web/Live (order.status peut suivre pending/confirmed/paid/shipped/
 *    delivered/cancelled — jamais mis à jour finement par article) :
 *      to_ship       : status 'confirmed' ou 'paid', pas encore d'étiquette
 *      label_created : étiquette générée, pas encore marquée expédiée
 *      shipped/delivered : d'après order.status
 *
 *  - B2B (orders.status reste figé à 'confirmed' dès le paiement — voir
 *    computeB2BOrderStatus, useB2BOrders.ts — le vrai statut vit dans
 *    order_items.fulfillment_status, par article) :
 *      to_ship : au moins un article actif a atteint 'delivery_requested'
 *                (le revendeur a validé sa demande de livraison) — un achat
 *                B2B simplement conservé en stockage (fulfillment_status
 *                'ordered'/'received'/'ready_to_ship', jamais demandé)
 *                N'EST PAS "à expédier" pour l'admin : rien à emballer tant
 *                que le revendeur n'a pas demandé sa livraison.
 *      label_created/shipped/delivered : mêmes rangs que
 *      computeB2BOrderStatus, jamais une logique différente.
 *
 * Toute commande annulée (quel que soit le canal) retombe dans 'other',
 * jamais dans 'to_ship'.
 */
export const getShipmentStatus = (order: OrderWithItems): Exclude<ShipmentStatus, 'all'> => {
  if (['cancelled', 'canceled', 'refunded'].includes(order.status)) return 'other';

  if (order.order_channel === 'b2b') {
    const activeItems = (order.order_items || []).filter((i) => i.status !== 'cancelled');
    if (activeItems.length === 0) return 'other';

    const ranks = activeItems.map((i) => FULFILLMENT_RANK[i.fulfillment_status || 'ordered'] ?? 0);
    const minRank = Math.min(...ranks);
    const maxRank = Math.max(...ranks);

    if (minRank === FULFILLMENT_RANK.delivered) return 'delivered';
    if (maxRank >= FULFILLMENT_RANK.shipped) return 'shipped';
    if (maxRank >= FULFILLMENT_RANK.label_created) return 'label_created';
    if (maxRank >= FULFILLMENT_RANK.delivery_requested) return 'to_ship';
    return 'other';
  }

  // Web / Live — une vente Live ne crée aujourd'hui jamais de ligne
  // `orders` (voir products.status='sold-auction'), donc cette branche ne
  // traite en pratique que le web.
  if (order.status === 'delivered') return 'delivered';
  if (order.status === 'shipped') return 'shipped';
  if (order.label_url) return 'label_created';
  if (order.status === 'confirmed' || order.status === 'paid') return 'to_ship';
  return 'other';
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