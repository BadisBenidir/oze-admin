import React from 'react';
import { Resellers } from './Resellers';
import { B2BOrders } from './B2BOrders';
import { Commissions } from './Commissions';

interface B2BProps {
  activeSubTab: string;
}

export const B2B: React.FC<B2BProps> = ({ activeSubTab }) => {
  switch (activeSubTab) {
    case 'b2b-orders':
      return <B2BOrders />;
    case 'commissions':
      return <Commissions />;
    case 'resellers':
    default:
      return <Resellers />;
  }
};
