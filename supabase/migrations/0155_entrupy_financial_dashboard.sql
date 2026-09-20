-- ============================================================================
-- Dashboard financier Entrupy : abonnement 139 $/mois (25 authentifications
-- incluses, 5,60 $/authentification au-delà), converti en € au taux retenu
-- (0,92) et comparé au CA facturé aux revendeurs (19,99 €/certificat) — ces
-- constantes de tarification restent côté frontend (EntrupyCertificates.tsx),
-- seule la donnée réellement opérationnelle et variable d'un mois à l'autre
-- (les certificats réalisés manuellement hors plateforme) est en base.
--
-- Complète 0154 : ajoute le suivi de ces ajustements manuels + une RPC de
-- suppression de certificat (pendant à admin_import_entrupy_certificate,
-- pour "remplacer ou supprimer le certificat existant" demandé ici).
-- ============================================================================

create table if not exists public.entrupy_manual_adjustments (
  month text primary key, -- format 'YYYY-MM'
  count integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.entrupy_manual_adjustments enable row level security;

drop policy if exists entrupy_manual_adjustments_admin_all on public.entrupy_manual_adjustments;
create policy entrupy_manual_adjustments_admin_all on public.entrupy_manual_adjustments
  for all using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on public.entrupy_manual_adjustments to authenticated;

-- Historique initial : 1 certificat déjà réalisé manuellement hors
-- plateforme ce mois-ci (voir demande) — à compter dans le quota consommé
-- et le CA du mois en cours.
insert into public.entrupy_manual_adjustments (month, count)
values (to_char(now(), 'YYYY-MM'), 1)
on conflict (month) do nothing;

create or replace function public.admin_delete_entrupy_certificate(p_order_item_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Accès refusé';
  end if;

  update public.order_items
  set entrupy_status = 'pending',
      entrupy_cert_url = null,
      entrupy_pdf_path = null,
      entrupy_completed_at = null
  where id = p_order_item_id and entrupy_requested = true;
end;
$$;

grant execute on function public.admin_delete_entrupy_certificate(uuid) to authenticated;

notify pgrst, 'reload schema';
