-- ============================================================================
-- Un article ne doit JAMAIS pouvoir être à la fois engagé dans une mission
-- de "Sourcing sur mesure" ET programmé dans un drop à venir — les deux
-- parcours se contredisent (l'un promet la pièce à un revendeur précis via
-- une avance déjà versée, l'autre la met en vente ouverte à tous à une date
-- fixe). Jusqu'ici rien n'empêchait techniquement les deux à la fois : les
-- deux pickers (AddSourcingItemModal "Depuis le stock", CreateDropModal)
-- filtraient chacun sur le statut produit ('draft'/'draft-b2b'), mais
-- ajouter un article au product_ids d'un drop ne change PAS son statut tant
-- que le drop n'est pas exécuté (voir execute_due_drops, 0031) — un article
-- déjà programmé dans un drop 'planifie' restait donc sélectionnable pour un
-- sourcing sans que rien ne le signale.
--
-- 1. Nettoyage rétroactif : priorité au sourcing (avance déjà versée par le
--    revendeur) — retire des drops 'planifie' tout article déjà engagé dans
--    une ligne de sourcing active (status <> 'cancelled'). Un drop qui se
--    retrouverait sans aucun article après retrait est annulé plutôt que de
--    violer drops_product_ids_not_empty avec un tableau vide.
-- 2. Garde-fous en base (triggers), pas seulement côté UI : bloquent toute
--    tentative d'ajouter un article déjà présent dans l'autre parcours,
--    quel que soit le chemin d'écriture (UI, RPC admin_reassign_drop_product
--    de 0067, etc.).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Nettoyage rétroactif des conflits existants.
-- ----------------------------------------------------------------------------
do $$
declare
  d record;
  v_new_ids uuid[];
begin
  for d in select id, product_ids from public.drops where status = 'planifie' loop
    select array_agg(pid) into v_new_ids
    from unnest(d.product_ids) as pid
    where pid not in (
      select product_id from public.b2b_sourcing_items
      where product_id is not null and status <> 'cancelled'
    );

    if v_new_ids is distinct from d.product_ids then
      if v_new_ids is null or array_length(v_new_ids, 1) is null then
        update public.drops set status = 'annule' where id = d.id;
      else
        update public.drops set product_ids = v_new_ids where id = d.id;
      end if;
    end if;
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 2a. Garde-fou côté sourcing : refuse de lier un article déjà programmé
-- dans un drop encore planifié.
-- ----------------------------------------------------------------------------
create or replace function public.guard_sourcing_item_not_in_drop()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.product_id is not null and (tg_op = 'INSERT' or old.product_id is distinct from new.product_id) then
    if exists (
      select 1 from public.drops d
      where d.status = 'planifie' and new.product_id = any(d.product_ids)
    ) then
      raise exception 'Cet article est déjà programmé dans un drop à venir — retirez-le du drop avant de le sourcer.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists sourcing_items_guard_not_in_drop on public.b2b_sourcing_items;
create trigger sourcing_items_guard_not_in_drop
before insert or update of product_id on public.b2b_sourcing_items
for each row execute function public.guard_sourcing_item_not_in_drop();

-- ----------------------------------------------------------------------------
-- 2b. Garde-fou côté drops : refuse qu'un drop planifié contienne un article
-- déjà engagé dans une ligne de sourcing active.
-- ----------------------------------------------------------------------------
create or replace function public.guard_drop_products_not_sourced()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conflict uuid;
begin
  if new.status = 'planifie' then
    select product_id into v_conflict
    from public.b2b_sourcing_items
    where product_id = any(new.product_ids) and status <> 'cancelled'
    limit 1;

    if v_conflict is not null then
      raise exception 'Un ou plusieurs articles de ce drop sont déjà engagés dans une mission de sourcing sur mesure.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists drops_guard_products_not_sourced on public.drops;
create trigger drops_guard_products_not_sourced
before insert or update of product_ids, status on public.drops
for each row execute function public.guard_drop_products_not_sourced();

notify pgrst, 'reload schema';
