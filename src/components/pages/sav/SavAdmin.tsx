import React, { useEffect, useState } from 'react';
import { SavTicketList } from './SavTicketList';
import { SavTicketDetail } from './SavTicketDetail';
import { SavKnowledgeBase } from './SavKnowledgeBase';

/** Onglet « SAV » de l'admin : Tickets, Litiges, Base de connaissances. */
export const SavAdmin: React.FC<{ activeSubTab: string }> = ({ activeSubTab }) => {
  const [openTicketId, setOpenTicketId] = useState<string | null>(null);

  useEffect(() => {
    setOpenTicketId(null);
  }, [activeSubTab]);

  if (activeSubTab === 'knowledge-base') return <SavKnowledgeBase />;

  if (openTicketId) {
    return (
      <SavTicketDetail
        key={openTicketId}
        ticketId={openTicketId}
        onBack={() => setOpenTicketId(null)}
        onOpenTicket={setOpenTicketId}
      />
    );
  }

  return <SavTicketList key={activeSubTab} disputes={activeSubTab === 'disputes'} onOpen={setOpenTicketId} />;
};
