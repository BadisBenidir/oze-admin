-- Ventes Instagram : livraison en point relais uniquement (domicile grisé sur
-- la page client). Le serveur refuse une adresse sans point relais.
do $$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('public.instagram_order_public_save(text, text, jsonb, uuid[])'::regprocedure);
  v_def := replace(v_def,
    $a$  if (v_sa ? 'pickup_point_name' or v_sa ? 'pickup_point_code')
     and (v_sa->>'pickup_point_name' is null$a$,
    $b$  if v_sa->>'pickup_point_name' is null then
    raise exception 'Choisissez un point relais (livraison à domicile indisponible)';
  end if;
  if (v_sa ? 'pickup_point_name' or v_sa ? 'pickup_point_code')
     and (v_sa->>'pickup_point_name' is null$b$);
  if position('livraison à domicile indisponible' in v_def) = 0 then
    raise exception 'Remplacement impossible';
  end if;
  execute v_def;
end $$;
