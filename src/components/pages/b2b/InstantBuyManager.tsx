import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Search, Zap, RefreshCw, Package, Archive, Lock, Unlock, Clock } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { Badge } from '../../ui/Badge';

interface Row {
  id: string;
  name: string | null;
  images: string[] | null;
  main_image_index: number | null;
  reference: string | null;
  b2b_reference: string | null;
  product_code: string | null;
  source_reference: string | null;
  status: string;
  sale_price: number | null;
  purchase_price: number | null;
  instant_buy: boolean;
  brand: { name: string } | null;
}

type View = 'live' | 'stock';

const STATUS_LABEL: Record<string, { label: string; variant: 'default' | 'info' | 'success' }> = {
  draft: { label: 'Brouillon', variant: 'default' },
  'draft-b2b': { label: 'Brouillon B2B', variant: 'default' },
  'for-sale-b2b': { label: 'Catalogue', variant: 'info' },
  'archived-instant-b2b': { label: 'Archivé achat immédiat', variant: 'default' },
};

/** Prix en achat immédiat (même règle que instant_buy_price, 0262) : prix
 * d'achat TTC × 1,55 sous 50 €, sinon × 1,40 si le prix dépasse 100 €,
 * sinon × 1,35 — au multiple de 5 inférieur. */
const instantPrice = (purchase: number | null): number | null => {
  if (!purchase || purchase <= 0) return null;
  if (purchase < 50) return Math.floor((purchase * 1.55) / 5) * 5;
  const at40 = Math.floor((purchase * 1.4) / 5) * 5;
  return at40 > 100 ? at40 : Math.floor((purchase * 1.35) / 5) * 5;
};

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const EUR = (n: number | null) => (n == null ? '—' : `${Number(n).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} €`);

/**
 * Onglet « Achat immédiat » : articles proposés dans l'onglet du même nom de
 * l'espace pro (statut 'instant-b2b', 0257). Ajout depuis le stock
 * (brouillons, B2B ou non, et articles déjà au Catalogue) un par un ou en
 * sélection — recherche multi-lignes pour coller une liste de références —,
 * archivage ('archived-instant-b2b', 0258) via admin_set_instant_buy.
 */
export const InstantBuyManager: React.FC = () => {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [view, setView] = useState<View>('live');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Blocage de la page côté espace pro (0254).
  const [locked, setLocked] = useState(false);
  const [lockMessage, setLockMessage] = useState('');
  const [lockBusy, setLockBusy] = useState(false);
  // Date limite d'achat (0259) : invendus archivés automatiquement ensuite.
  const [endsAt, setEndsAt] = useState<string | null>(null);
  const [deadlineInput, setDeadlineInput] = useState('');
  const [deadlineBusy, setDeadlineBusy] = useState(false);
  const toLocalInput = (iso: string) => {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  useEffect(() => {
    supabase.rpc('get_instant_buy_lock').then(({ data }) => {
      const row = data as { locked?: boolean; message?: string | null; ends_at?: string | null } | null;
      setLocked(Boolean(row?.locked));
      setLockMessage(row?.message || '');
      setEndsAt(row?.ends_at ?? null);
      setDeadlineInput(row?.ends_at ? toLocalInput(row.ends_at) : '');
    });
  }, []);

  const saveDeadline = async (value: string | null) => {
    setDeadlineBusy(true);
    setError(null);
    setNotice(null);
    const iso = value ? new Date(value).toISOString() : null;
    const { data, error: rpcError } = await supabase.rpc('admin_set_instant_buy_deadline', { p_ends_at: iso });
    setDeadlineBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    const row = data as { ends_at?: string | null } | null;
    setEndsAt(row?.ends_at ?? null);
    setDeadlineInput(row?.ends_at ? toLocalInput(row.ends_at) : '');
    setNotice(row?.ends_at ? `Date limite enregistrée : ${new Date(row.ends_at).toLocaleString('fr-FR')}.` : 'Date limite retirée : vente sans limite de temps.');
  };
  const deadlinePassed = endsAt ? new Date(endsAt).getTime() <= Date.now() : false;

  const saveLock = async (nextLocked: boolean) => {
    setLockBusy(true);
    setError(null);
    const { data, error: lockError } = await supabase.rpc('admin_set_instant_buy_lock', { p_locked: nextLocked, p_message: lockMessage });
    setLockBusy(false);
    if (lockError) {
      setError(lockError.message);
      return;
    }
    const row = data as { locked?: boolean; message?: string | null } | null;
    setLocked(Boolean(row?.locked));
    setLockMessage(row?.message || '');
    setNotice(row?.locked ? "Page Achat immédiat bloquée : les revendeurs voient le cadenas." : 'Page Achat immédiat ouverte aux revendeurs.');
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [productsRes, dropsRes] = await Promise.all([
      supabase
        .from('products')
        .select('id, name, images, main_image_index, reference, b2b_reference, product_code, source_reference, status, sale_price, purchase_price, instant_buy, brand:brands(name)')
        .in('status', ['draft', 'draft-b2b', 'for-sale-b2b', 'instant-b2b', 'archived-instant-b2b'])
        .order('created_at', { ascending: false })
        .limit(5000),
      supabase.from('drops').select('product_ids').eq('status', 'planifie'),
    ]);
    if (productsRes.error) setError(productsRes.error.message);
    // Articles d'un drop planifié : gérés par le drop, jamais proposés ici.
    const inPlannedDrop = new Set((dropsRes.data || []).flatMap((d) => (d.product_ids as string[]) || []));
    setRows((((productsRes.data || []) as unknown) as Row[]).filter((r) => r.instant_buy || !inPlannedDrop.has(r.id)));
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const terms = useMemo(
    () => Array.from(new Set(query.split(/[\n\r\t;]+/).map((t) => norm(t.trim())).filter(Boolean))),
    [query]
  );

  const haystackOf = (r: Row) =>
    norm([r.name, r.brand?.name, r.b2b_reference, r.reference, r.product_code, r.source_reference].filter(Boolean).join(' '));

  const liveCount = rows.filter((r) => r.instant_buy).length;
  const stockCount = rows.length - liveCount;

  const { visible, notFound } = useMemo(() => {
    const inView = rows.filter((r) => (view === 'live' ? r.instant_buy : !r.instant_buy));
    if (terms.length === 0) return { visible: inView, notFound: [] as string[] };
    const hay = new Map(inView.map((r) => [r.id, haystackOf(r)]));
    const matched = inView.filter((r) => terms.some((t) => hay.get(r.id)!.includes(t)));
    const missing = terms.length > 1 ? terms.filter((t) => !inView.some((r) => hay.get(r.id)!.includes(t))) : [];
    return { visible: matched, notFound: missing };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, terms, view]);

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

  const switchView = (next: View) => {
    setView(next);
    setSelected(new Set());
    setNotice(null);
  };

  const apply = async (ids: string[], enabled: boolean) => {
    if (ids.length === 0) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const { data, error: rpcError } = await supabase.rpc('admin_set_instant_buy', {
      p_product_ids: ids,
      p_enabled: enabled,
      p_target: 'archived-instant-b2b',
    });
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    const count = Number(data?.updated_count || 0);
    const s = count > 1 ? 's' : '';
    setNotice(enabled ? `${count} article${s} mis en achat immédiat.` : `${count} article${s} archivé${s}.`);
    setSelected(new Set());
    await load();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Achat immédiat</h2>
          <p className="text-sm text-gray-500">
            Articles proposés dans l'onglet « Achat Immédiat » de l'espace pro. Prix appliqué automatiquement depuis le prix d'achat TTC : × 1,55 s'il est sous 50 €, sinon × 1,40 au-dessus de 100 € de prix de vente, × 1,35 en dessous.
          </p>
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

      <div className={`rounded-xl border p-4 ${locked ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 bg-white'}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {locked ? <Lock className="h-5 w-5" /> : <Unlock className="h-5 w-5 text-gray-500" />}
            <div>
              <p className="font-medium">{locked ? 'Page bloquée' : 'Page ouverte'}</p>
              <p className={`text-sm ${locked ? 'text-gray-300' : 'text-gray-500'}`}>
                {locked
                  ? 'Les revendeurs voient un cadenas et le message ci-dessous, aucun article.'
                  : 'Les revendeurs voient les articles en achat immédiat.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => saveLock(!locked)}
            disabled={lockBusy}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50 ${
              locked ? 'bg-white text-gray-900 hover:bg-gray-100' : 'bg-gray-900 text-white hover:bg-gray-800'
            }`}
          >
            {locked ? <Unlock className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
            {lockBusy ? 'En cours…' : locked ? 'Débloquer la page' : 'Bloquer la page'}
          </button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            value={lockMessage}
            onChange={(e) => setLockMessage(e.target.value)}
            placeholder="Message affiché sous le cadenas (par défaut : Aucun article disponible pour le moment.)"
            className="min-w-[240px] flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-gray-400 focus:outline-none"
          />
          {locked && (
            <button
              type="button"
              onClick={() => saveLock(true)}
              disabled={lockBusy}
              className="rounded-lg border border-white/30 px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-50"
            >
              Enregistrer le message
            </button>
          )}
        </div>
      </div>

      <div className={`rounded-xl border p-4 ${deadlinePassed ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-white'}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Clock className="h-5 w-5 text-gray-500" />
            <div>
              <p className="font-medium text-gray-900">Date limite d'achat</p>
              <p className="text-sm text-gray-500">
                {!endsAt
                  ? 'Aucune : la vente reste ouverte sans limite de temps.'
                  : deadlinePassed
                    ? `Vente terminée le ${new Date(endsAt).toLocaleString('fr-FR')} : les invendus sont archivés (« Archivé achat immédiat »). Fixez une nouvelle date pour rouvrir.`
                    : `Fin le ${new Date(endsAt).toLocaleString('fr-FR')} : compte à rebours affiché aux revendeurs, puis invendus archivés automatiquement.`}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="datetime-local"
              value={deadlineInput}
              onChange={(e) => setDeadlineInput(e.target.value)}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-gray-400 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => saveDeadline(deadlineInput)}
              disabled={deadlineBusy || !deadlineInput}
              className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
            >
              {deadlineBusy ? 'En cours…' : 'Enregistrer'}
            </button>
            {endsAt && (
              <button
                type="button"
                onClick={() => saveDeadline(null)}
                disabled={deadlineBusy}
                className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Retirer
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[240px] flex-1">
          <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
          <textarea
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            rows={Math.min(Math.max(query.split('\n').length, 1), 8)}
            placeholder="Article, marque, référence, réf. fournisseur… — une par ligne pour coller une liste"
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
            onClick={() => switchView('live')}
            className={`rounded-md px-3 py-1.5 ${view === 'live' ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
          >
            En achat immédiat ({liveCount})
          </button>
          <button
            type="button"
            onClick={() => switchView('stock')}
            className={`rounded-md px-3 py-1.5 ${view === 'stock' ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
          >
            Ajouter depuis le stock ({stockCount})
          </button>
        </div>
      </div>

      {notFound.length > 0 && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          Introuvable{notFound.length > 1 ? 's' : ''} dans cet onglet ({notFound.length}) : <span className="font-mono">{notFound.join(' · ')}</span>
        </p>
      )}

      {visible.length > 0 && (
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

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm">
          <span className="text-amber-900">
            {selected.size} article{selected.size > 1 ? 's' : ''} sélectionné{selected.size > 1 ? 's' : ''}
          </span>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setSelected(new Set())} className="rounded-lg px-3 py-1.5 text-gray-600 hover:bg-white">
              Désélectionner
            </button>
            {view === 'stock' ? (
              <button
                type="button"
                onClick={() => apply([...selected], true)}
                disabled={busy}
                className="flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-1.5 font-medium text-white hover:bg-gray-800 disabled:opacity-50"
              >
                <Zap className="h-4 w-4" />
                {busy ? 'En cours…' : `Mettre en achat immédiat (${selected.size})`}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => apply([...selected], false)}
                disabled={busy}
                className="flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                <Archive className="h-4 w-4" /> {busy ? 'En cours…' : `Archiver (${selected.size})`}
              </button>
            )}
          </div>
        </div>
      )}

      {error && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {notice && <p className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700">{notice}</p>}

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        {loading && rows.length === 0 ? (
          <p className="p-6 text-sm text-gray-500">Chargement…</p>
        ) : visible.length === 0 ? (
          <p className="p-6 text-sm text-gray-500">
            {query
              ? 'Aucun article ne correspond à la recherche.'
              : view === 'live'
                ? 'Aucun article en achat immédiat pour le moment — ajoutez-en depuis le stock.'
                : 'Aucun article disponible dans le stock.'}
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs text-gray-500">
                <th className="w-10 px-4 py-2.5">
                  <input type="checkbox" checked={allVisibleSelected} onChange={toggleAll} className="h-4 w-4 rounded border-gray-300" />
                </th>
                <th className="px-4 py-2.5 font-medium">Article</th>
                <th className="px-4 py-2.5 font-medium">Réf. fournisseur</th>
                <th className="px-4 py-2.5 font-medium">Prix B2B</th>
                <th className="px-4 py-2.5 font-medium">Statut</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const images = r.images || [];
                const image = images[r.main_image_index ?? 0] || images[0];
                const ref = r.b2b_reference || r.reference || r.product_code;
                const status = r.instant_buy ? { label: 'Achat immédiat', variant: 'success' as const } : STATUS_LABEL[r.status] || { label: r.status, variant: 'default' as const };
                return (
                  <tr key={r.id} className="border-b border-gray-50 last:border-b-0 hover:bg-gray-50/60">
                    <td className="px-4 py-3">
                      <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} className="h-4 w-4 rounded border-gray-300" />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gray-100">
                          {image ? <img src={image} alt="" className="h-full w-full object-cover" /> : <Package className="h-4 w-4 text-gray-300" />}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate font-medium text-gray-900">{r.name || 'Article'}</p>
                          <p className="text-xs text-gray-500">
                            {r.brand?.name && <span>{r.brand.name} · </span>}
                            {ref ? `Réf. ${ref}` : ''}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {r.source_reference ? (
                        <span className="whitespace-nowrap rounded-md bg-gray-100 px-2 py-1 font-mono text-sm font-semibold text-gray-900">{r.source_reference}</span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-900">
                      {view === 'stock' && instantPrice(r.purchase_price) != null && instantPrice(r.purchase_price) !== Number(r.sale_price) ? (
                        <span title="Prix appliqué en achat immédiat (55 % sous 50 € de prix d’achat, 40 % au-dessus de 100 €, 35 % entre les deux)">
                          <span className="text-gray-400 line-through">{EUR(r.sale_price)}</span>{' '}
                          <span className="font-medium">→ {EUR(instantPrice(r.purchase_price))}</span>
                        </span>
                      ) : (
                        EUR(r.sale_price)
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={status.variant}>{status.label}</Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {view === 'stock' ? (
                        <button
                          type="button"
                          onClick={() => apply([r.id], true)}
                          disabled={busy || (!r.sale_price && !r.purchase_price)}
                          title={!r.sale_price && !r.purchase_price ? 'Renseignez d’abord un prix' : undefined}
                          className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50"
                        >
                          <Zap className="h-3.5 w-3.5" /> Achat immédiat
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => apply([r.id], false)}
                          disabled={busy}
                          className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                        >
                          <Archive className="h-3.5 w-3.5" /> Archiver
                        </button>
                      )}
                    </td>
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

export default InstantBuyManager;
