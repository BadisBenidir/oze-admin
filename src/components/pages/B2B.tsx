import React from 'react';
import { Resellers } from './Resellers';
import { B2BProducts } from './B2BProducts';
import { B2BRevenue } from './B2BRevenue';
import { B2BDrops } from './B2BDrops';
import { B2BPromoCodes } from './B2BPromoCodes';
import { B2BSourcing } from './B2BSourcing';
import { GiftRewards } from './b2b/GiftRewards';

interface B2BProps {
  activeSubTab: string;
}

export const B2B: React.FC<B2BProps> = ({ activeSubTab }) => {
  switch (activeSubTab) {
    case 'b2b-products':
      return <B2BProducts />;
    case 'drops':
      return <B2BDrops />;
    case 'sourcing':
      return <B2BSourcing />;
    case 'promo-codes':
      return <B2BPromoCodes />;
    case 'commissions':
      return <B2BRevenue />;
    case 'gift-rewards':
      return <GiftRewards />;
    case 'resellers':
    default:
      return <Resellers />;
  }
};
