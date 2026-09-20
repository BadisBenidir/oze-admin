-- ============================================================================
-- Gestion et import des certificats Entrupy (Admin + Espace Client).
--
-- order_items.entrupy_requested/entrupy_cost (0083) marquent déjà qu'une
-- pièce doit recevoir un certificat et son coût facturé, mais rien ne
-- suivait l'état réel de l'édition du document par l'équipe (upload PDF ou
-- lien officiel Entrupy). Ajoute ce suivi + une RPC d'import admin,
-- ré-appelable pour remplacer un certificat déjà importé.
-- ============================================================================

alter table public.order_items add column if not exists entrupy_status text not null default 'pending';
alter table public.order_items add constraint order_items_entrupy_status_check
  check (entrupy_status in ('pending', 'completed'));
alter table public.order_items add column if not exists entrupy_cert_url text;
alter table public.order_items add column if not exists entrupy_pdf_path text;
alter table public.order_items add column if not exists entrupy_completed_at timestamptz;

create or replace function public.admin_import_entrupy_certificate(
  p_order_item_id uuid,
  p_cert_url text,
  p_pdf_path text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item record;
begin
  if not public.is_admin() then
    raise exception 'Accès refusé';
  end if;

  select id, entrupy_requested into v_item from public.order_items where id = p_order_item_id;
  if v_item is null then
    raise exception 'Article introuvable';
  end if;
  if not v_item.entrupy_requested then
    raise exception 'Cet article n''a pas de certificat Entrupy demandé';
  end if;
  if p_cert_url is null or trim(p_cert_url) = '' then
    raise exception 'URL du certificat manquante';
  end if;

  update public.order_items
  set entrupy_status = 'completed',
      entrupy_cert_url = trim(p_cert_url),
      entrupy_pdf_path = p_pdf_path,
      entrupy_completed_at = now()
  where id = p_order_item_id;
end;
$$;

grant execute on function public.admin_import_entrupy_certificate(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
