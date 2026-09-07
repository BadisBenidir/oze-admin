-- ============================================================================
-- Émission réelle des factures via l'API Qonto (Business API) — voir l'edge
-- function emit-qonto-invoice. Ajoute uniquement le stockage nécessaire :
-- l'émission elle-même (appel réseau à Qonto) ne peut pas se faire depuis
-- SQL, elle vit entièrement dans l'edge function.
-- ============================================================================

-- Client Qonto mis en cache sur LE PROFIL (jamais sur `resellers`, même
-- convention que legal_status/siret depuis 0109 : indépendant par
-- sous-compte) — évite de recréer un client Qonto à chaque facture.
alter table public.profiles
  add column if not exists qonto_client_id text;

comment on column public.profiles.qonto_client_id is
  'Id du client créé côté Qonto (POST /v2/clients) — mis en cache pour ne jamais le recréer à chaque facture émise pour ce profil.';

-- Résultat de l'émission Qonto sur la facture elle-même.
alter table public.invoices
  add column if not exists qonto_invoice_id text,
  add column if not exists qonto_invoice_number text,
  add column if not exists pdf_url text;

comment on column public.invoices.qonto_invoice_id is
  'Id de la facture côté Qonto (POST /v2/client_invoices) — null tant que jsPDF sert de document provisoire (aucune émission Qonto encore déclenchée).';
comment on column public.invoices.qonto_invoice_number is
  'Numéro OFFICIEL attribué par Qonto à l''émission (distinct de invoice_number, notre séquence interne FAC-YYYY-NNNNN conservée comme référence de secours) — c''est ce numéro qui fait foi une fois présent.';
comment on column public.invoices.pdf_url is
  'URL du PDF officiel certifié renvoyé par Qonto — une fois présent, remplace le PDF jsPDF généré à la volée côté client.';

-- Qonto peut renvoyer 'direct_pdf' (facture PDF simple, hors routage PDP —
-- typiquement B2C) en plus des statuts déjà prévus.
alter table public.invoices drop constraint if exists invoices_transmission_status_check;
alter table public.invoices add constraint invoices_transmission_status_check
  check (transmission_status in ('not_applicable', 'pending', 'sent', 'failed', 'direct_pdf'));

notify pgrst, 'reload schema';
