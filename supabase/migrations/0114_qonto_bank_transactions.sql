-- ============================================================================
-- Comptabilité & Trésorerie Qonto — cache local des transactions bancaires
-- (bank_transactions) et du solde live (bank_account_snapshot), alimentés
-- par l'edge function qonto-sync (jamais interrogé en direct depuis le
-- navigateur : la clé secrète Qonto ne doit jamais quitter le serveur,
-- même principe que STRIPE_SECRET_KEY dans b2b-checkout/wallet-topup).
--
-- Réutilise `expenses` (déjà existante, voir useExpenses.ts — laissée
-- intacte lors de la refonte de la page Comptabilité) plutôt que de créer
-- une notion parallèle de "dépense" : une transaction bancaire de type
-- dépense (ex: "Dédouanement DHL") se lie à une ligne `expenses`, créée à
-- la volée si besoin, au lieu d'exister uniquement dans bank_transactions.
-- ============================================================================

create table if not exists public.bank_transactions (
  id uuid primary key default gen_random_uuid(),
  qonto_transaction_id text not null unique,
  qonto_status text,
  side text not null check (side in ('debit', 'credit')),
  operation_type text,
  amount numeric(12, 2) not null check (amount >= 0),
  currency text not null default 'EUR',
  label text,
  counterparty_name text,
  emitted_at timestamptz,
  settled_at timestamptz,
  -- Ids d'attachment Qonto déjà présents côté Qonto au moment du sync
  -- (justificatif ajouté directement dans leur interface) — distinct de
  -- matched_expense_id (justificatif géré depuis CE back-office).
  attachment_ids jsonb not null default '[]'::jsonb,
  reconciliation_status text not null default 'unmatched' check (reconciliation_status in ('unmatched', 'matched', 'ignored')),
  matched_type text check (matched_type in ('order', 'sourcing_mission', 'expense', 'stripe_payout', 'other')),
  matched_order_id uuid references public.orders (id) on delete set null,
  matched_sourcing_mission_id uuid references public.b2b_sourcing_missions (id) on delete set null,
  matched_expense_id uuid references public.expenses (id) on delete set null,
  note text,
  -- Réponse Qonto brute pour cette transaction — filet de sécurité si un
  -- champ non modélisé ici est nécessaire plus tard, sans nouveau sync.
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists bank_transactions_settled_at_idx on public.bank_transactions (settled_at desc);
create index if not exists bank_transactions_reconciliation_status_idx on public.bank_transactions (reconciliation_status);

-- Solde live Qonto : ligne unique (id fixe 'main'), écrasée à chaque sync —
-- évite d'interroger /v2/organizations à chaque affichage du dashboard,
-- gros risque de rate-limit sinon (voir consigne "cache" de la demande).
create table if not exists public.bank_account_snapshot (
  id text primary key default 'main',
  balance numeric(12, 2) not null default 0,
  currency text not null default 'EUR',
  iban text,
  fetched_at timestamptz not null default now()
);

alter table public.bank_transactions enable row level security;
alter table public.bank_account_snapshot enable row level security;

drop policy if exists bank_transactions_admin_all on public.bank_transactions;
create policy bank_transactions_admin_all on public.bank_transactions
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists bank_account_snapshot_admin_all on public.bank_account_snapshot;
create policy bank_account_snapshot_admin_all on public.bank_account_snapshot
  for all using (public.is_admin()) with check (public.is_admin());

revoke all on public.bank_transactions from public, authenticated;
revoke all on public.bank_account_snapshot from public, authenticated;
grant select, insert, update, delete on public.bank_transactions to authenticated;
grant select, insert, update, delete on public.bank_account_snapshot to authenticated;

-- Rattachement d'une dépense existante à sa transaction bancaire / commande /
-- mission de sourcing d'origine — colonnes additives, nullable, sans
-- backfill : n'affecte aucune dépense déjà saisie.
alter table public.expenses
  add column if not exists linked_order_id uuid references public.orders (id) on delete set null,
  add column if not exists linked_sourcing_mission_id uuid references public.b2b_sourcing_missions (id) on delete set null,
  add column if not exists qonto_transaction_id text;

-- ----------------------------------------------------------------------------
-- pg_cron + pg_net : synchronise Qonto toutes les 3 heures (compromis entre
-- fraîcheur des données et rate-limit Qonto — le bouton "Rafraîchir les
-- données bancaires" reste le moyen principal d'avoir un état à jour à la
-- demande). Même schéma de garde que 0113_jpy_eur_rate_history.sql.
--
-- ⚠️ ACTION MANUELLE REQUISE : remplacer <PROJECT_REF> ci-dessous (Project
-- Settings > General, ou l'URL du dashboard) AVANT d'exécuter cette
-- migration. Si qonto-sync n'est pas encore déployée
-- (`supabase functions deploy qonto-sync`), le job échouera silencieusement
-- toutes les 3 heures jusqu'au déploiement, sans casser autre chose.
-- ----------------------------------------------------------------------------
do $$
begin
  create extension if not exists pg_net with schema extensions;
exception when others then
  raise notice 'pg_net indisponible automatiquement — à activer manuellement via Database > Extensions dans le dashboard Supabase.';
end $$;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'qonto-sync-periodic') then
    perform cron.unschedule('qonto-sync-periodic');
  end if;
exception when others then
  null;
end $$;

do $$
begin
  perform cron.schedule(
    'qonto-sync-periodic',
    '0 */3 * * *',
    $cron$
      select net.http_post(
        url := 'https://<PROJECT_REF>.supabase.co/functions/v1/qonto-sync',
        headers := '{"Content-Type": "application/json"}'::jsonb,
        body := '{}'::jsonb
      );
    $cron$
  );
exception when others then
  raise notice 'Impossible de programmer qonto-sync-periodic automatiquement — à faire manuellement une fois pg_net/pg_cron actifs et <PROJECT_REF> remplacé, via cron.schedule().';
end $$;

notify pgrst, 'reload schema';
