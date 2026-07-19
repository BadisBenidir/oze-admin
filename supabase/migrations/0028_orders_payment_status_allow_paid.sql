-- confirm_b2b_payment insère payment_status = 'paid' depuis toujours
-- (migration 0011, avant même ce chantier B2B checkout) — une convention
-- délibérément distincte de 'succeeded' côté B2C, déjà attendue par du code
-- existant (B2BOrdersList.tsx, useGroupableOrder.ts, Accounting.tsx). Mais
-- orders_payment_status_check n'a apparemment jamais été élargie pour
-- l'accepter : elle ne connaît que le vocabulaire B2C ('pending',
-- 'succeeded', 'failed', 'refunded'), d'où l'échec de confirm_b2b_payment
-- (silencieux côté webhook jusqu'ici, faute d'un paiement B2B ayant abouti).
--
-- On élargit la contrainte plutôt que de changer le code, pour ne pas casser
-- les trois endroits qui dépendent déjà de 'paid'.

alter table public.orders drop constraint if exists orders_payment_status_check;

alter table public.orders
  add constraint orders_payment_status_check
  check (payment_status in ('pending', 'succeeded', 'paid', 'failed', 'refunded'));
