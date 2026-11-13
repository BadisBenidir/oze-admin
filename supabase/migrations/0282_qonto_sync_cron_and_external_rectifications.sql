-- 1. Synchro Qonto automatique : le job « qonto-sync-periodic » (0114)
--    appelait https://<PROJECT_REF>.supabase.co/... (modèle jamais remplacé)
--    et échouait à chaque passage. Reprogrammé deux fois par jour (vers 7 h
--    et 19 h, heure de Paris ; pg_cron tourne en UTC) avec la bonne URL.
--    qonto-sync est déployée sans JWT ; la synchro peut durer jusqu'à
--    150 s, d'où le délai d'attente de pg_net relevé.
--
-- 2. Factures à rectifier (0281) : une facture peut avoir été régularisée
--    hors de l'admin (avoir + nouvelle facture émis directement sur Qonto,
--    par ex.). Statut « external » : retirée des brouillons, jamais
--    renumérotée ; la référence de la régularisation est notée.

do $$
begin
  perform cron.unschedule('qonto-sync-periodic');
exception when others then
  null;
end $$;

select cron.schedule(
  'qonto-sync-periodic',
  '0 6,18 * * *',
  $cron$
    select net.http_post(
      url := 'https://bmsasmqkmnlijpvoisep.supabase.co/functions/v1/qonto-sync',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := '{}'::jsonb,
      timeout_milliseconds := 150000
    );
  $cron$
);

alter table public.vat_invoice_rectifications drop constraint if exists vat_invoice_rectifications_status_check;
alter table public.vat_invoice_rectifications
  add constraint vat_invoice_rectifications_status_check check (status in ('draft', 'issued', 'external'));
alter table public.vat_invoice_rectifications add column if not exists external_note text;

-- Marque (ou dé-marque, p_note null) une rectificative comme régularisée
-- hors de l'admin. Sans effet sur une rectificative déjà émise ici.
create or replace function public.vat_mark_rectification_external(p_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.vat_is_owner_or_server() then
    raise exception 'Réservé au propriétaire';
  end if;
  update public.vat_invoice_rectifications
  set status = case when p_note is null then 'draft' else 'external' end,
      external_note = nullif(trim(p_note), ''),
      issued_at = case when p_note is null then null else now() end
  where id = p_id and status <> 'issued';
end;
$$;

revoke all on function public.vat_mark_rectification_external(uuid, text) from public, anon;
grant execute on function public.vat_mark_rectification_external(uuid, text) to authenticated;

notify pgrst, 'reload schema';
