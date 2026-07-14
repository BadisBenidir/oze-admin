import React from 'react';
import { useResellerAuth } from '../../../hooks/useResellerAuth';
import { useMyB2BOrders } from '../../../hooks/useMyB2BOrders';
import { B2BOrdersList } from './B2BOrdersList';

export const MyOrders: React.FC = () => {
  const { isReseller, profile } = useResellerAuth();
  const { orders, loading, error } = useMyB2BOrders(isReseller, profile?.id);

  return (
    <div className="p-4 md:p-6">
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-gray-900">Mes commandes</h3>
        <p className="text-sm text-gray-500">{loading ? 'Chargement...' : `${orders.length} commande${orders.length > 1 ? 's' : ''}`}</p>
      </div>

      <B2BOrdersList
        orders={orders}
        loading={loading}
        error={error}
        emptyMessage="Vos commandes passées depuis le catalogue apparaîtront ici."
      />
    </div>
  );
};
