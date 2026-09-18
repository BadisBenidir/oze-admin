-- ============================================================================
-- Corrige execute_due_auction_sessions (0142) : la clôture automatique
-- fermait TOUS les lots actifs d'une session dès que ends_at de la SESSION
-- était dépassé, y compris les lots dont ends_at avait été repoussé par la
-- prolongation anti-snipe (voir place_auto_bid, "ends_at = case when
-- ends_at - now() < interval '5 minutes' then now() + interval '5 minutes'
-- else ends_at end") — un lot pouvait donc être coupé court en pleine
-- prolongation.
--
-- close_auction_session_core (bouton "Clôturer" manuel de l'admin, force la
-- clôture immédiate de tout, comportement volontaire) N'EST PAS modifiée.
-- Seule execute_due_auction_sessions (cron automatique) change : elle ne
-- clôture désormais que les lots dont le temps est RÉELLEMENT écoulé
-- (ends_at propre au lot <= now()), et ne fait passer la session à
-- 'closed' que lorsque plus aucun lot n'est actif — tant qu'un lot est
-- encore en prolongation anti-snipe, la session reste 'live' (les
-- revendeurs continuent à la voir et à enchérir sur ce lot, place_auto_bid
-- ne se basant que sur le statut/ends_at du LOT, jamais sur celui de la
-- session).
-- ============================================================================

create or replace function public.execute_due_auction_sessions()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  due_session record;
  v_item_id uuid;
  v_remaining int;
begin
  update public.auction_sessions
  set status = 'live'
  where status = 'upcoming' and starts_at <= now();

  for due_session in
    select id from public.auction_sessions
    where status = 'live' and ends_at <= now()
  loop
    update public.auction_items
    set
      status = case
        when current_winner_id is not null and (reserve_price is null or current_price >= reserve_price) then 'sold'
        else 'unsold'
      end,
      payment_deadline = case
        when current_winner_id is not null and (reserve_price is null or current_price >= reserve_price) then now() + interval '24 hours'
        else payment_deadline
      end
    where session_id = due_session.id and status = 'active' and ends_at <= now();

    for v_item_id in
      select id from public.auction_items
      where session_id = due_session.id and status = 'sold' and order_id is null
    loop
      begin
        perform public.generate_order_from_auction_item_core(v_item_id);
      exception when others then
        null; -- même tolérance que close_auction_session_core : n'empêche pas de traiter les autres lots.
      end;
    end loop;

    select count(*) into v_remaining from public.auction_items where session_id = due_session.id and status = 'active';
    if v_remaining = 0 then
      update public.auction_sessions set status = 'closed' where id = due_session.id;
    end if;
  end loop;
end;
$$;

notify pgrst, 'reload schema';
