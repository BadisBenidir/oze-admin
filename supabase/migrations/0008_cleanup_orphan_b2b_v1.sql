-- ============================================================================
-- Nettoyage de l'ancien prototype B2B (tables b2b_partners / b2b_products /
-- b2b_orders), abandonné au profit du module actuel (resellers,
-- reseller_contacts, products.status = 'for-sale-b2b', orders.order_channel
-- = 'b2b'). Les Edge Functions b2b-create-partner et b2b-place-order qui les
-- utilisaient ont déjà été supprimées.
--
-- Ce script ne supprime les tables QUE si elles sont vides. S'il y a la
-- moindre ligne dedans, il s'arrête avec une erreur au lieu de continuer —
-- dans ce cas, regarde le contenu avant de relancer.
-- ============================================================================

do $$
declare
  cnt bigint;
begin
  if to_regclass('public.b2b_orders') is not null then
    execute 'select count(*) from public.b2b_orders' into cnt;
    if cnt > 0 then
      raise exception 'b2b_orders contient % ligne(s) — vérifie avant de supprimer', cnt;
    end if;
  end if;

  if to_regclass('public.b2b_products') is not null then
    execute 'select count(*) from public.b2b_products' into cnt;
    if cnt > 0 then
      raise exception 'b2b_products contient % ligne(s) — vérifie avant de supprimer', cnt;
    end if;
  end if;

  if to_regclass('public.b2b_partners') is not null then
    execute 'select count(*) from public.b2b_partners' into cnt;
    if cnt > 0 then
      raise exception 'b2b_partners contient % ligne(s) — vérifie avant de supprimer', cnt;
    end if;
  end if;
end $$;

-- Si on arrive ici, les 3 tables (celles qui existent) sont vides.
drop table if exists public.b2b_orders;
drop table if exists public.b2b_products;
drop table if exists public.b2b_partners;
