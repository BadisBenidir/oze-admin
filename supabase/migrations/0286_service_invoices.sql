-- Factures de prestation (ex. « Pack Luxe 6 mois » facturé à un partenaire) :
-- ni commande ni mission de sourcing. Même table, même numérotation
-- (invoice_counters, FAC-AAAA-NNNNN) que les factures de commande et
-- d'avance ; libellé de la ligne dans service_label.

alter table public.invoices drop constraint if exists invoices_kind_check;
alter table public.invoices add constraint invoices_kind_check
  check (kind = any (array['order'::text, 'advance'::text, 'service'::text]));

alter table public.invoices add column if not exists service_label text;

comment on column public.invoices.service_label is
  'Facture de prestation (kind = service) : libellé de la prestation facturée.';

notify pgrst, 'reload schema';
