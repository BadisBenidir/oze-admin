-- ============================================================================
-- Achat immédiat : alerte email à l'admin à chaque vente.
--
-- Les pièces en achat immédiat ne sont pas encore achetées chez le
-- fournisseur (Buy It Now Aucnet). Dès qu'un revendeur en achète une, l'admin
-- reçoit un email avec la référence fournisseur pour l'acheter tout de suite.
--
--   - instant_buy_sale_alerts : une ligne par article vendu depuis l'achat
--     immédiat (instant_sold_at posé par 0258) ; sent_at une fois l'email
--     parti. Unique par produit : jamais deux alertes pour la même vente.
--   - le trigger crée la ligne puis appelle l'Edge Function
--     instant-buy-sale-alert (pg_net, asynchrone : ne ralentit ni ne bloque
--     jamais le paiement) ;
--   - filet de sécurité : la même fonction passe toutes les 5 minutes (cron)
--     et envoie les alertes restées sans sent_at.
-- L'Edge Function ne lit rien de la requête : elle traite seulement les
-- lignes en attente de cette table (appel public sans risque).
-- ============================================================================

create table if not exists public.instant_buy_sale_alerts (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  claimed_at timestamptz, -- pris en charge par un appel en cours (évite les doublons)
  attempts int not null default 0,
  last_error text,
  constraint instant_buy_sale_alerts_product_unique unique (product_id)
);

alter table public.instant_buy_sale_alerts enable row level security;
-- Aucune policy : accès uniquement via le service role (Edge Function).

create or replace function public.enqueue_instant_buy_sale_alert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.instant_sold_at is not null and old.instant_sold_at is null then
    insert into public.instant_buy_sale_alerts (product_id)
    values (new.id)
    on conflict (product_id) do nothing;

    begin
      perform net.http_post(
        url := 'https://bmsasmqkmnlijpvoisep.supabase.co/functions/v1/instant-buy-sale-alert',
        headers := '{"Content-Type": "application/json"}'::jsonb,
        body := '{}'::jsonb
      );
    exception when others then
      -- Jamais bloquant : le cron rattrapera l'envoi.
      null;
    end;
  end if;
  return new;
end;
$$;

-- « after update of status » et non « of instant_sold_at » : instant_sold_at
-- est posé par le trigger BEFORE de 0258 pendant le changement de statut, et
-- un trigger de colonne ne se déclenche que pour les colonnes de la requête.
drop trigger if exists products_instant_buy_sale_alert on public.products;
create trigger products_instant_buy_sale_alert
  after update of status on public.products
  for each row execute function public.enqueue_instant_buy_sale_alert();

do $$
begin
  perform cron.unschedule('instant-buy-sale-alert-retry')
  where exists (select 1 from cron.job where jobname = 'instant-buy-sale-alert-retry');

  perform cron.schedule(
    'instant-buy-sale-alert-retry',
    '*/5 * * * *',
    $cron$
      select net.http_post(
        url := 'https://bmsasmqkmnlijpvoisep.supabase.co/functions/v1/instant-buy-sale-alert',
        headers := '{"Content-Type": "application/json"}'::jsonb,
        body := '{}'::jsonb
      )
      where exists (select 1 from public.instant_buy_sale_alerts where sent_at is null and attempts < 5);
    $cron$
  );
end $$;

notify pgrst, 'reload schema';
