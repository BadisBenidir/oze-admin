-- ============================================================================
-- Allègement de la base pendant les drops.
--
-- 1. Réservations panier : signal diffusé (Realtime « broadcast »,
--    realtime.send) sur le canal public 'reservation-signals', au lieu de
--    postgres_changes sur product_reservation_signals. postgres_changes
--    relit le journal et revérifie la RLS de CHAQUE membre connecté pour
--    CHAQUE changement : c'était la première charge de la base pendant un
--    drop. Le signal ne contient que l'id du produit (aucune donnée
--    sensible). La table product_reservation_signals est conservée (lue
--    nulle part ailleurs que par Realtime) mais retirée de la publication.
--    Les onglets restés ouverts sur l'ancienne version se rafraîchissent
--    encore toutes les 60 s (filet de sécurité de Catalog.tsx).
--
-- 2. net._http_response (journal des appels HTTP sortants de pg_net) :
--    l'autovacuum ne passait plus (47 Mo pour 4 lignes, nettoyage de pg_net
--    jusqu'à 89 s sous charge). VACUUM quotidien via pg_cron.
-- ============================================================================

create or replace function public.sync_product_reservation_signal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product_id uuid := coalesce(new.product_id, old.product_id);
begin
  if tg_op = 'DELETE' then
    delete from public.product_reservation_signals where product_id = old.product_id;
  elsif new.expires_at is null then
    delete from public.product_reservation_signals where product_id = new.product_id;
  else
    insert into public.product_reservation_signals (product_id, reserved_until, updated_at)
    values (new.product_id, new.expires_at, now())
    on conflict (product_id) do update
      set reserved_until = excluded.reserved_until, updated_at = now();
  end if;

  -- Signal diffusé : jamais bloquant pour l'ajout/retrait au panier.
  begin
    perform realtime.send(jsonb_build_object('product_id', v_product_id), 'signal', 'reservation-signals', false);
  exception when others then
    null;
  end;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

do $$
begin
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'product_reservation_signals'
  ) then
    alter publication supabase_realtime drop table public.product_reservation_signals;
  end if;
end $$;

-- Nettoyage quotidien (4h10) du journal pg_net.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'vacuum-pg-net-responses') then
    perform cron.unschedule('vacuum-pg-net-responses');
  end if;
  perform cron.schedule('vacuum-pg-net-responses', '10 4 * * *', 'VACUUM net._http_response');
end $$;
