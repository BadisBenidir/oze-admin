import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Search, PackageCheck, RefreshCw, Package } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { Badge } from '../../ui/Badge';

type Stage = 'ordered' | 'received' | 'ready_to_ship';

interface Row {
  id: string;
  fulfillment_status: Stage;
  product_snapshot: { name?: string; images?: string[]; main_image_index?: number } | null;
  product: { name: string | null; images: string[] | null; main_image_index: number | null; reference: string | null; b2b_reference: string | null; product_code: string | null; source_reference: string | null; brand: { name: string } | null } | null;
  order: {
    order_number: string;
    email: string | null;
    reseller: { company_name: string } | null;
    placed_by: { first_name: string | null; last_name: string | null } | null;
  } | null;
}

const STAGE_LABEL: Record<Stage, { label: string; variant: 'warning' | 'info' | 'success' }> = {
  ordered: { label: 'En acheminement', variant: 'warning' },
  received: { label: 'Reçu', variant: 'info' },
  ready_to_ship: { label: 'Prêt à la livraison', variant: 'success' },
};

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Onglet « Prêt à la livraison » : tous les articles B2B pas encore prêts
 * (en acheminement ou reçus), recherche par article / référence / acheteur /
 * commande, et passage direct en « prêt à la livraison », un par un ou en
 * sélection multiple. Un article encore « en acheminement » est d'abord
 * marqué reçu (admin_mark_items_received), puis prêt
 * (admin_mark_items_ready_to_ship) — mêmes RPC que la Vue Réception.
 */
export const ReadyToShipManager: React.FC = () => {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'todo' | 'ready'>('todo');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: fetchError } = await supabase
      .from('order_items')
      .select(
        'id, fulfillment_status, product_snapshot, ' +
          'product:products(name, images, main_image_index, reference, b2b_reference, product_code, source_reference, brand:brands(name)), ' +
          'order:orders!inner(order_number, email, order_channel, reseller:resellers(company_name), placed_by:profiles!placed_by_profile_id(first_name, last_name))'
      )
      .eq('status', 'active')
      .eq('order.order_channel', 'b2b')
      .in('fulfillment_status', ['ordered', 'received', 'ready_to_ship'])
      .order('created_at', { ascending: false })
      .limit(3000);
    if (fetchError) setError(fetchError.message);
    setRows(((data || []) as unknown) as Row[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Une recherche par ligne : une liste de références collée affiche tous
  // les articles correspondant à au moins une ligne.
  const terms = useMemo(
    () => Array.from(new Set(query.split(/[\n\r\t;]+/).map((t) => norm(t.trim())).filter(Boolean))),
    [query]
  );

  const haystackOf = (r: Row) => {
      const buyer = r.order?.placed_by ? `${r.order.placed_by.first_name || ''} ${r.order.placed_by.last_name || ''}` : '';
      const haystack = [
        r.product?.name || r.product_snapshot?.name,
        r.product?.brand?.name,
        r.product?.b2b_reference,
        r.product?.reference,
        r.product?.product_code,
        r.product?.source_reference,
        r.order?.order_number,
        r.order?.email,
        r.order?.reseller?.company_name,
        buyer,
      ]
        .filter(Boolean)
        .join(' ');
      return norm(haystack);
  };

  const { visible, notFound } = useMemo(() => {
    const inTab = rows.filter((r) => (filter === 'todo' ? r.fulfillment_status !== 'ready_to_ship' : r.fulfillment_status === 'ready_to_ship'));
    if (terms.length === 0) return { visible: inTab, notFound: [] as string[] };
    const hay = new Map(inTab.map((r) => [r.id, haystackOf(r)]));
    const matched = inTab.filter((r) => terms.some((t) => hay.get(r.id)!.includes(t)));
    const missing = terms.length > 1 ? terms.filter((t) => !inTab.some((r) => hay.get(r.id)!.includes(t))) : [];
    return { visible: matched, notFound: missing };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, terms, filter]);

  const todoCount = rows.filter((r) => r.fulfillment_status !== 'ready_to_ship').length;
  const readyCount = rows.length - todoCount;
  const selectable = filter === 'todo';
  const allVisibleSelected = visible.length > 0 && visible.every((r) => selected.has(r.id));

  const toggle = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAll = () =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (allVisibleSelected) visible.forEach((r) => next.delete(r.id));
      else visible.forEach((r) => next.add(r.id));
      return next;
    });

  const markReady = async (ids: string[]) => {
    if (ids.length === 0) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const ordered = rows.filter((r) => ids.includes(r.id) && r.fulfillment_status === 'ordered').map((r) => r.id);
    if (ordered.length > 0) {
      const { error: receivedError } = await supabase.rpc('admin_mark_items_received', { p_item_ids: ordered });
      if (receivedError) {
        setBusy(false);
        setError(receivedError.message);
        return;
      }
    }
    const { data, error: readyError } = await supabase.rpc('admin_mark_items_ready_to_ship', { p_item_ids: ids });
    setBusy(false);
    if (readyError) {
      setError(readyError.message);
      return;
    }
    const count = Number(data?.updated_count || 0);
    setNotice(`${count} article${count > 1 ? 's' : ''} passé${count > 1 ? 's' : ''} prêt${count > 1 ? 's' : ''} à la livraison.`);
    setSelected(new Set());
    await load();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Prêt à la livraison</h2>
          <p className="text-sm text-gray-500">Recherchez un article et passez-le prêt à la livraison, seul ou en sélection.</p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Actualiser
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[240px] flex-1">
          <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
          <textarea
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            rows={Math.min(Math.max(query.split('\n').length, 1), 8)}
            placeholder="Article, référence, réf. fournisseur, acheteur, commande… — une par ligne pour coller une liste"
            className="w-full resize-y rounded-lg border border-gray-200 bg-white py-2.5 pl-9 pr-3 text-sm focus:border-gray-400 focus:outline-none"
          />
          {terms.length > 1 && (
            <p className="mt-1 text-xs text-gray-500">
              {terms.length} recherches · {visible.length} article{visible.length > 1 ? 's' : ''} trouvé{visible.length > 1 ? 's' : ''}
            </p>
          )}
        </div>
        <div className="flex rounded-lg border border-gray-200 bg-white p-0.5 text-sm">
          <button
            type="button"
            onClick={() => setFilter('todo')}
            className={`rounded-md px-3 py-1.5 ${filter === 'todo' ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
          >
            À passer prêt ({todoCount})
          </button>
          <button
            type="button"
            onClick={() => setFilter('ready')}
            className={`rounded-md px-3 py-1.5 ${filter === 'ready' ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
          >
            Déjà prêts ({readyCount})
          </button>
        </div>
      </div>

      {notFound.length > 0 && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          Introuvable{notFound.length > 1 ? 's' : ''} dans cet onglet ({notFound.length}) : <span className="font-mono">{notFound.join(' · ')}</span>
        </p>
      )}

      {selectable && visible.length > 0 && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={toggleAll}
            className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            {allVisibleSelected ? 'Tout désélectionner' : `Sélectionner tout (${visible.length})`}
          </button>
        </div>
      )}

      {selectable && selected.size > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-2.5 text-sm">
          <span className="text-green-800">
            {selected.size} article{selected.size > 1 ? 's' : ''} sélectionné{selected.size > 1 ? 's' : ''}
          </span>
          <div className="flex gap-2">
            <button type="button" onClick={() => setSelected(new Set())} className="rounded-lg px-3 py-1.5 text-gray-600 hover:bg-white">
              Désélectionner
            </button>
            <button
              type="button"
              onClick={() => markReady([...selected])}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-1.5 font-medium text-white hover:bg-green-700 disabled:opacity-50"
            >
              <PackageCheck className="h-4 w-4" />
              {busy ? 'En cours…' : `Mettre prêt à la livraison (${selected.size})`}
            </button>
          </div>
        </div>
      )}

      {error && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {notice && <p className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700">{notice}</p>}

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        {loading && rows.length === 0 ? (
          <p className="p-6 text-sm text-gray-500">Chargement…</p>
        ) : visible.length === 0 ? (
          <p className="p-6 text-sm text-gray-500">Aucun article{query ? ' ne correspond à la recherche' : ''}.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs text-gray-500">
                {selectable && (
                  <th className="w-10 px-4 py-2.5">
                    <input type="checkbox" checked={allVisibleSelected} onChange={toggleAll} className="h-4 w-4 rounded border-gray-300" />
                  </th>
                )}
                <th className="px-4 py-2.5 font-medium">Article</th>
                <th className="px-4 py-2.5 font-medium">Réf. fournisseur</th>
                <th className="px-4 py-2.5 font-medium">Acheteur</th>
                <th className="px-4 py-2.5 font-medium">Commande</th>
                <th className="px-4 py-2.5 font-medium">Statut</th>
                {selectable && <th className="px-4 py-2.5" />}
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const images = r.product?.images || r.product_snapshot?.images || [];
                const image = images[r.product?.main_image_index ?? r.product_snapshot?.main_image_index ?? 0] || images[0];
                const ref = r.product?.b2b_reference || r.product?.reference || r.product?.product_code;
                const buyer = r.order?.placed_by
                  ? `${r.order.placed_by.first_name || ''} ${r.order.placed_by.last_name || ''}`.trim()
                  : r.order?.email || '—';
                const stage = STAGE_LABEL[r.fulfillment_status];
                return (
                  <tr key={r.id} className="border-b border-gray-50 last:border-b-0 hover:bg-gray-50/60">
                    {selectable && (
                      <td className="px-4 py-3">
                        <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} className="h-4 w-4 rounded border-gray-300" />
                      </td>
                    )}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gray-100">
                          {image ? <img src={image} alt="" className="h-full w-full object-cover" /> : <Package className="h-4 w-4 text-gray-300" />}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate font-medium text-gray-900">{r.product?.name || r.product_snapshot?.name || 'Article'}</p>
                          <p className="text-xs text-gray-500">
                            {r.product?.brand?.name && <span>{r.product.brand.name} · </span>}
                            {ref ? `Réf. ${ref}` : ''}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {r.product?.source_reference ? (
                        <span className="rounded-md bg-gray-100 px-2 py-1 font-mono text-sm font-semibold text-gray-900 whitespace-nowrap">
                          {r.product.source_reference}
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-gray-900">{buyer || '—'}</p>
                      <p className="text-xs text-gray-500">{r.order?.reseller?.company_name}</p>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600 whitespace-nowrap">{r.order?.order_number}</td>
                    <td className="px-4 py-3">
                      <Badge variant={stage.variant}>{stage.label}</Badge>
                    </td>
                    {selectable && (
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => markReady([r.id])}
                          disabled={busy}
                          className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-green-200 px-2.5 py-1.5 text-xs font-medium text-green-700 hover:bg-green-50 disabled:opacity-50"
                        >
                          <PackageCheck className="h-3.5 w-3.5" /> Prêt à la livraison
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default ReadyToShipManager;
