-- ============================================================================
-- Nouveau statut `drop-b2b` : un article ajouté au product_ids d'un drop
-- encore planifié est désormais visuellement distinguable d'un simple
-- brouillon dans "Gestion des Produits" — jusqu'ici il restait affiché
-- 'draft'/'draft-b2b' jusqu'à l'exécution du drop (execute_due_drops, 0031),
-- aucun moyen de savoir au premier coup d'œil qu'il était déjà programmé.
-- Même patron que 'sourced-b2b' (0122) / 'draft-b2b' (0130).
--
-- Bénéfice secondaire : simplifie 0134 (empêcher le chevauchement
-- sourcing/drops) — un article 'drop-b2b' est maintenant naturellement
-- exclu du picker "Depuis le stock" (qui ne liste que 'draft'/'draft-b2b')
-- par le simple filtre de statut, plus besoin de vérifier séparément le
-- product_ids des drops planifiés côté client.
-- ============================================================================

alter table public.products drop constraint if exists products_status_check;
alter table public.products
  add constraint products_status_check check (status in (
    'draft', 'draft-b2b', 'sourced-b2b', 'drop-b2b', 'for-sale-online', 'for-sale-other-platform', 'sold-online',
    'sold-other-platform', 'sold-display', 'for-auction-live', 'sold-auction',
    'for-sale-b2b', 'reserved-b2b', 'sold-b2b', 'archived',
    'cadeau', 'cadeau-attribue', 'cadeau-livre'
  ));

-- ----------------------------------------------------------------------------
-- generate_b2b_reference (0016/0130) : attribue aussi une référence B2B dès
-- l'entrée en 'drop-b2b' — un article ajouté à un drop directement depuis un
-- brouillon générique (jamais passé par 'draft-b2b') n'en avait pas encore.
-- ----------------------------------------------------------------------------
create or replace function public.generate_b2b_reference()
returns trigger
language plpgsql
as $$
declare
  v_year text := to_char(now(), 'YYYY');
  v_candidate text;
  v_attempts int := 0;
begin
  if new.status in ('draft-b2b', 'drop-b2b', 'for-sale-b2b', 'reserved-b2b', 'sold-b2b') and new.b2b_reference is null then
    loop
      v_candidate := 'OZE-B2B-' || v_year || '-' || lpad(floor(random() * 10000)::int::text, 4, '0');
      exit when not exists (select 1 from public.products where b2b_reference = v_candidate);
      v_attempts := v_attempts + 1;
      if v_attempts > 50 then
        raise exception 'Impossible de générer une référence B2B unique après 50 tentatives';
      end if;
    end loop;
    new.b2b_reference := v_candidate;
  end if;
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- execute_due_drops (0031/0130) : les articles d'un drop échu sont
-- normalement déjà 'drop-b2b' à ce stade (voir sync_drop_product_status
-- ci-dessous), mais accepte aussi 'draft'/'draft-b2b' par sécurité si le
-- trigger de synchronisation n'avait pas encore tourné pour une raison
-- quelconque.
-- ----------------------------------------------------------------------------
create or replace function public.execute_due_drops()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  due_drop record;
begin
  for due_drop in
    select id, product_ids
    from public.drops
    where status = 'planifie' and scheduled_at <= now()
    order by scheduled_at
  loop
    update public.products
    set status = 'for-sale-b2b'
    where id = any(due_drop.product_ids) and status in ('draft', 'draft-b2b', 'drop-b2b');

    update public.drops
    set status = 'publie', published_at = now()
    where id = due_drop.id;
  end loop;
end;
$$;

-- ----------------------------------------------------------------------------
-- sync_drop_product_status : bascule les articles vers 'drop-b2b' dès leur
-- ajout au product_ids d'un drop planifié, et les libère ('draft-b2b' si une
-- référence B2B existe déjà, sinon 'draft') dès qu'ils en sortent — retrait
-- individuel (édition du drop), ou annulation complète du drop. Jamais
-- déclenché à l'exécution normale (execute_due_drops fixe directement
-- 'for-sale-b2b' avant de passer le drop à 'publie', donc new.status n'est
-- alors ni 'planifie' ni 'annule' ici).
-- ----------------------------------------------------------------------------
create or replace function public.sync_drop_product_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_added uuid[];
  v_removed uuid[];
begin
  if tg_op = 'INSERT' then
    if new.status = 'planifie' then
      update public.products
      set status = 'drop-b2b'
      where id = any(new.product_ids) and status in ('draft', 'draft-b2b');
    end if;
    return new;
  end if;

  if new.status = 'annule' and old.status = 'planifie' then
    update public.products
    set status = case when b2b_reference is not null then 'draft-b2b' else 'draft' end
    where id = any(old.product_ids) and status = 'drop-b2b';
    return new;
  end if;

  if new.status = 'planifie' and old.product_ids is distinct from new.product_ids then
    select array_agg(pid) into v_added
    from unnest(new.product_ids) as pid
    where pid <> all (coalesce(old.product_ids, array[]::uuid[]));

    select array_agg(pid) into v_removed
    from unnest(old.product_ids) as pid
    where pid <> all (coalesce(new.product_ids, array[]::uuid[]));

    if v_added is not null then
      update public.products set status = 'drop-b2b' where id = any(v_added) and status in ('draft', 'draft-b2b');
    end if;
    if v_removed is not null then
      update public.products
      set status = case when b2b_reference is not null then 'draft-b2b' else 'draft' end
      where id = any(v_removed) and status = 'drop-b2b';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists drops_sync_product_status on public.drops;
create trigger drops_sync_product_status
after insert or update of product_ids, status on public.drops
for each row execute function public.sync_drop_product_status();

-- ----------------------------------------------------------------------------
-- Backfill : articles déjà présents dans un drop 'planifie' (donc jamais
-- encore exécuté) et toujours 'draft'/'draft-b2b' faute de ce trigger.
-- ----------------------------------------------------------------------------
update public.products p
set status = 'drop-b2b'
where p.status in ('draft', 'draft-b2b')
  and exists (
    select 1 from public.drops d
    where d.status = 'planifie' and p.id = any(d.product_ids)
  );

-- ----------------------------------------------------------------------------
-- b2b_catalog / b2b_reseller_product_detail (0129/0130) : l'avant-première
-- drops filtrait sur status in ('draft','draft-b2b') — désormais insuffisant
-- puisque ces articles passent en 'drop-b2b' dès leur ajout au drop.
-- ----------------------------------------------------------------------------
create or replace view public.b2b_catalog as
select
  p.id, p.product_code, p.reference, p.b2b_reference, p.name, p.brand_id, p.category_id, p.genre,
  p.weight, p.images, p.main_image_index, p.condition, p.description, p.colors,
  p.material, p.status, p.created_at, p.sale_price as price,
  p.defects, p.defect_images,
  exists (
    select 1 from public.cart_items ci
    where ci.product_id = p.id
      and ci.user_id <> auth.uid()
      and ci.expires_at is not null and ci.expires_at > now()
  ) as held_by_other,
  p.original_price,
  (
    select d.scheduled_at
    from public.drops d
    where d.status = 'planifie' and p.id = any(d.product_ids)
    order by d.scheduled_at asc
    limit 1
  ) as drop_preview_scheduled_at
from public.products p
where (
  p.status = 'for-sale-b2b'
  and exists (
    select 1 from public.reseller_contacts rc
    join public.resellers rs on rs.id = rc.reseller_id
    where rc.profile_id = auth.uid() and rs.status = 'active'
  )
)
or (
  p.status in ('draft', 'draft-b2b', 'drop-b2b')
  and exists (
    select 1 from public.drops d
    where d.status = 'planifie' and p.id = any(d.product_ids)
  )
  and exists (
    select 1 from public.reseller_contacts rc
    join public.resellers rs on rs.id = rc.reseller_id
    where rc.profile_id = auth.uid() and rs.status = 'active' and rc.can_preview_drops = true
  )
);

grant select on public.b2b_catalog to authenticated;

create or replace view public.b2b_reseller_product_detail as
select
  p.id, p.product_code, p.reference, p.b2b_reference, p.name, p.brand_id, p.category_id, p.genre,
  p.weight, p.images, p.main_image_index, p.condition, p.description, p.colors,
  p.material, p.status, p.created_at, p.sale_price as price,
  p.defects, p.defect_images,
  exists (
    select 1 from public.cart_items ci
    where ci.product_id = p.id
      and ci.user_id <> auth.uid()
      and ci.expires_at is not null and ci.expires_at > now()
  ) as held_by_other,
  p.original_price,
  (
    select d.scheduled_at
    from public.drops d
    where d.status = 'planifie' and p.id = any(d.product_ids)
    order by d.scheduled_at asc
    limit 1
  ) as drop_preview_scheduled_at
from public.products p
where (
  p.status = 'for-sale-b2b'
  and exists (
    select 1 from public.reseller_contacts rc
    join public.resellers rs on rs.id = rc.reseller_id
    where rc.profile_id = auth.uid() and rs.status = 'active'
  )
)
or (
  p.status in ('draft', 'draft-b2b', 'drop-b2b')
  and exists (
    select 1 from public.drops d
    where d.status = 'planifie' and p.id = any(d.product_ids)
  )
  and exists (
    select 1 from public.reseller_contacts rc
    join public.resellers rs on rs.id = rc.reseller_id
    where rc.profile_id = auth.uid() and rs.status = 'active' and rc.can_preview_drops = true
  )
)
or exists (
  select 1
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  where oi.product_id = p.id
    and o.reseller_id = public.current_reseller_id()
);

grant select on public.b2b_reseller_product_detail to authenticated;

notify pgrst, 'reload schema';
