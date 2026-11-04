-- Solde portefeuille arrondi au centime.
-- Des montants calculés côté JS (0.1 + 0.2…) laissaient des soldes comme
-- 305.2599999999999999 : le front affiche 305,26 €, le paiement mixte demande
-- à débiter 305.26 et debit_wallet_amount refuse (« Solde insuffisant »),
-- d'où « Le solde a changé entre-temps » pour le client.

-- 1. Corrige l'existant.
update public.profiles set wallet_balance = round(wallet_balance, 2)
where wallet_balance <> round(wallet_balance, 2);
update public.wallet_transactions set amount = round(amount, 2)
where amount <> round(amount, 2) and round(amount, 2) > 0;

-- 2. Arrondit désormais toute écriture.
create or replace function public.round_wallet_balance()
returns trigger language plpgsql as $$
begin
  if new.wallet_balance is not null then
    new.wallet_balance := round(new.wallet_balance, 2);
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_round_wallet_balance on public.profiles;
create trigger profiles_round_wallet_balance
before insert or update of wallet_balance on public.profiles
for each row execute function public.round_wallet_balance();

create or replace function public.round_wallet_transaction_amount()
returns trigger language plpgsql as $$
begin
  if new.amount is not null and round(new.amount, 2) > 0 then
    new.amount := round(new.amount, 2);
  end if;
  return new;
end;
$$;

drop trigger if exists wallet_transactions_round_amount on public.wallet_transactions;
create trigger wallet_transactions_round_amount
before insert or update of amount on public.wallet_transactions
for each row execute function public.round_wallet_transaction_amount();
