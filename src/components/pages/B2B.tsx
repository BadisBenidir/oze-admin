import React from 'react';
import { Resellers } from './Resellers';
import { B2BProducts } from './B2BProducts';
import { B2BOrders } from './B2BOrders';
import { B2BRevenue } from './B2BRevenue';
import { B2BPortal } from './B2BPortal';
import { B2BDrops } from './B2BDrops';
import { B2BPromoCodes } from './B2BPromoCodes';

interface B2BProps {
  activeSubTab: string;
}

export const B2B: React.FC<B2BProps> = ({ activeSubTab }) => {
  switch (activeSubTab) {
    case 'b2b-products':
      return <B2BProducts />;
    case 'drops':
      return <B2BDrops />;
    case 'promo-codes':
      return <B2BPromoCodes />;
    case 'b2b-orders':
      return <B2BOrders />;
    case 'commissions':
      return <B2BRevenue />;
    case 'portal':
      return <B2BPortal />;
    case 'resellers':
    default:
      return <Resellers />;
  }
};
