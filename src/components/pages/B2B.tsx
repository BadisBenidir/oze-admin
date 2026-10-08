import React from 'react';
import { Resellers } from './Resellers';
import { B2BProducts } from './B2BProducts';
import { B2BRevenue } from './B2BRevenue';
import { B2BDrops } from './B2BDrops';
import { B2BPromoCodes } from './B2BPromoCodes';
import { B2BSourcing } from './B2BSourcing';
import { GiftRewards } from './b2b/GiftRewards';
import { AuctionsAdmin } from './b2b/AuctionsAdmin';
import { EntrupyCertificates } from './b2b/EntrupyCertificates';
import { SubscriptionPromoCodes } from './b2b/SubscriptionPromoCodes';

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
    case 'auctions':
      return <AuctionsAdmin />;
    case 'promo-codes':
      return <B2BPromoCodes />;
    case 'club-promo-codes':
      return <SubscriptionPromoCodes />;
    case 'commissions':
      return <B2BRevenue />;
    case 'gift-rewards':
      return <GiftRewards />;
    case 'entrupy':
      return <EntrupyCertificates />;
    case 'subscribers':
      return <Resellers key="subscribers" accountType="subscriber" />;
    case 'resellers':
    default:
      return <Resellers key="companies" />;
  }
};
