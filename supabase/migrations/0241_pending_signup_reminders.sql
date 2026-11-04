-- Relance manuelle des inscriptions Club non payées depuis l'admin (section Abonnés) :
-- date et nombre de relances envoyées (automatique à l'expiration de la session
-- Stripe + boutons « Relancer » de l'admin, Edge Function admin-pending-signups).

alter table public.b2b_pending_signups add column if not exists last_reminded_at timestamptz;
alter table public.b2b_pending_signups add column if not exists reminder_count integer not null default 0;

notify pgrst, 'reload schema';
