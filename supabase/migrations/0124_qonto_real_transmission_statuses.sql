-- ============================================================================
-- Élargit invoices.transmission_status aux VRAIS statuts renvoyés par
-- Qonto (confirmés par un appel réel réussi pendant le diagnostic de
-- l'émission : 'unpaid' pour une facture finalisée, 'draft' sinon) — le
-- code stocke désormais le statut Qonto brut plutôt qu'un remappage
-- imaginé avant tout accès réel à l'API.
-- ============================================================================

alter table public.invoices drop constraint if exists invoices_transmission_status_check;
alter table public.invoices add constraint invoices_transmission_status_check
  check (transmission_status in (
    'not_applicable', 'pending', 'sent', 'failed', 'direct_pdf',
    'draft', 'unpaid', 'paid', 'cancelled'
  ));
