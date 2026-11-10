-- ============================================================================
-- Achat immédiat : marge de 50 % pour les pièces dont le prix de revient
-- (prix d'achat taxes comprises) est inférieur à 50 €.
--   prix de revient < 50 €      : × 1,50
--   sinon, prix > 100 €          : × 1,40
--   sinon                        : × 1,35
-- Toujours arrondi au multiple de 5 inférieur (0258). Les pièces déjà en
-- achat immédiat sous 50 € de prix de revient sont recalculées.
-- ============================================================================

create or replace function public.instant_buy_price(p_purchase_price numeric)
returns numeric
language sql
immutable
as $$
  select case
    when coalesce(p_purchase_price, 0) <= 0 then null
    when p_purchase_price < 50 then floor(p_purchase_price * 1.50 / 5) * 5
    when floor(p_purchase_price * 1.40 / 5) * 5 > 100 then floor(p_purchase_price * 1.40 / 5) * 5
    else floor(p_purchase_price * 1.35 / 5) * 5
  end;
$$;

update public.products
set sale_price = public.instant_buy_price(purchase_price)
where status::text = 'instant-b2b'
  and purchase_price > 0 and purchase_price < 50;
