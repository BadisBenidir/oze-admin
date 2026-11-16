import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Copy, Check, Plus, RefreshCw, Search, X, Package, Loader2, Ban, BadgeEuro, AlertTriangle } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { Badge } from '../../ui/Badge';
import { ShippingLabelButton } from '../../orders/ShippingLabelButton';
import { OrderTrackingCell } from '../../orders/OrderTrackingCell';

/**
 * Ventes Instagram (B2C, migrations 0300-0302) : l'admin crée un lien de
 * commande (articles du stock + prix TTC), l'envoie en DM ; le client
 * remplit sa livraison, paie par virement, récupère sa facture et suit son
 * colis sur pro.ozeparis.com/commande/<jeton>.
 */

const PUBLIC_BASE = 'https://pro.ozeparis.com/commande/';
const SELLABLE = ['draft', 'draft-b2b', 'sourced-b2b', 'drop-b2b', 'for-sale-b2b', 'instant-b2b', 'for-sale-online', 'for-sale-other-platform'];

const STATUS_LABEL: Record<string, string> = {
  draft: 'Brouillon',
  'draft-b2b': 'Brouillon',
  'sourced-b2b': 'Sourcing sur mesure',
  'drop-b2b': 'Drop',
  'for-sale-b2b': 'En vente B2B',
  'instant-b2b': 'Achat immédiat',
  'for-sale-online': 'En vente en ligne',
  'for-sale-other-platform': 'Autre plateforme',
};

type Stage = 'link_sent' | 'info_submitted' | 'transfer_declared' | 'paid' | 'shipped' | 'delivered' | 'expired' | 'cancelled' | 'payment_conflict';

const STAGE: Record<Stage, { label: string; variant: 'default' | 'info' | 'warning' | 'success' | 'danger' }> = {
  link_sent: { label: 'Lien envoyé', variant: 'default' },
  info_submitted: { label: 'Infos remplies', variant: 'info' },
  transfer_declared: { label: 'Virement annoncé', variant: 'warning' },
  paid: { label: 'Payé', variant: 'success' },
  shipped: { label: 'Expédié', variant: 'success' },
  delivered: { label: 'Livré', variant: 'success' },
  expired: { label: 'Expiré', variant: 'default' },
  cancelled: { label: 'Annulé', variant: 'default' },
  payment_conflict: { label: 'Payé après expiration — à traiter', variant: 'danger' },
};

interface LinkRow {
  id: string;
  token: string;
  payment_reference: string;
  instagram_handle: string | null;
  expires_at: string;
  created_at: string;
  info_submitted_at: string | null;
  transfer_declared_at: string | null;
  paid_at: string | null;
  paid_manually: boolean;
  expired_at: string | null;
  cancelled_at: string | null;
  late_payment_conflict: boolean;
  invoice_emailed_at: string | null;
  entrupy_product_ids: string[];
  order: {
    id: string;
    order_number: string;
    email: string;
    status: string;
    total_amount: number;
    shipping_address: Record<string, string> | null;
    tracking_number: string | null;
    tracking_url: string | null;
    label_url: string | null;
    items: { product_id: string; unit_price: number; product_snapshot: { name?: string; brand_name?: string; images?: string[]; main_image_index?: number; purchase_price?: number } | null }[];
  } | null;
}

const stageOf = (l: LinkRow): Stage => {
  if (l.late_payment_conflict) return 'payment_conflict';
  if (l.cancelled_at && !l.paid_at) return 'cancelled';
  if (!l.paid_at && l.expired_at) return 'expired';
  if (!l.paid_at && l.transfer_declared_at) return 'transfer_declared';
  if (!l.paid_at && l.info_submitted_at) return 'info_submitted';
  if (!l.paid_at) return 'link_sent';
  if (l.order?.status === 'delivered') return 'delivered';
  if (l.order?.status === 'shipped') return 'shipped';
  return 'paid';
};

const eur = (n: number) => (Number(n) || 0).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
const fmt = (d: string | null) => (d ? new Date(d).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
const imageOf = (images?: string[] | null, idx?: number | null) => (images || [])[idx ?? 0] || (images || [])[0];

// ---------------------------------------------------------------------------
interface ProductHit {
  id: string;
  name: string;
  status: string;
  images: string[] | null;
  main_image_index: number | null;
  b2b_reference: string | null;
  reference: string | null;
  source_reference: string | null;
  purchase_price: number | null;
  sale_price: number | null;
  brand: { name: string } | null;
}

const CreateOrderPanel: React.FC<{ onClose: () => void; onCreated: (token: string) => void }> = ({ onClose, onCreated }) => {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<ProductHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<(ProductHit & { price: string })[]>([]);
  const [handle, setHandle] = useState('');
  const [hours, setHours] = useState(48);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const term = q.replace(/[,()%*]/g, ' ').trim();
    // Sans recherche : les brouillons, proposés d'office. Avec recherche :
    // tous les articles disponibles.
    const t = setTimeout(async () => {
      setSearching(true);
      let query = supabase
        .from('products')
        .select('id, name, status, images, main_image_index, b2b_reference, reference, source_reference, purchase_price, sale_price, brand:brands(name)');
      if (term.length < 2) {
        query = query.in('status', ['draft', 'draft-b2b']);
      } else {
        const like = `%${term}%`;
        query = query
          .in('status', SELLABLE)
          .or(`name.ilike.${like},b2b_reference.ilike.${like},reference.ilike.${like},source_reference.ilike.${like},product_code.ilike.${like}`);
      }
      const { data } = await query.order('created_at', { ascending: false }).limit(term.length < 2 ? 100 : 30);
      setHits(((data || []) as unknown) as ProductHit[]);
      setSearching(false);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const add = (p: ProductHit) => {
    if (picked.some((x) => x.id === p.id)) return;
    setPicked((cur) => [...cur, { ...p, price: '' }]);
  };
  const total = picked.reduce((s, p) => s + (Number(p.price.replace(',', '.')) || 0), 0);
  const valid = picked.length > 0 && picked.every((p) => Number(p.price.replace(',', '.')) > 0);

  const create = async () => {
    setBusy(true);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc('admin_create_instagram_order', {
      p_items: picked.map((p) => ({ product_id: p.id, price: Number(p.price.replace(',', '.')) })),
      p_instagram_handle: handle || null,
      p_hours: hours,
    });
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    onCreated((data as { token: string }).token);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
      <div className="w-full max-w-3xl rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <h3 className="text-lg font-semibold text-gray-900">Nouvelle commande Instagram</h3>
          <button onClick={onClose} className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-5 p-5">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Articles du stock</label>
            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Nom, référence OZE, réf. fournisseur…"
                className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm focus:border-gray-400 focus:outline-none"
              />
            </div>
            {(hits.length > 0 || searching) && (
              <div className="mt-2 max-h-72 overflow-y-auto rounded-lg border border-gray-100">
                {q.trim().length < 2 && !searching && (
                  <p className="sticky top-0 bg-gray-50 px-3 py-1.5 text-xs font-medium text-gray-500">
                    Articles en brouillon ({hits.length}) — tapez pour chercher dans tout le stock disponible
                  </p>
                )}
                {searching && <p className="p-3 text-sm text-gray-500">Recherche…</p>}
                {hits.map((h) => (
                  <button
                    key={h.id}
                    type="button"
                    onClick={() => add(h)}
                    disabled={picked.some((x) => x.id === h.id)}
                    className="flex w-full items-center gap-3 border-b border-gray-50 px-3 py-2 text-left last:border-b-0 hover:bg-gray-50 disabled:opacity-40"
                  >
                    <div className="h-10 w-10 flex-shrink-0 overflow-hidden rounded bg-gray-100">
                      {imageOf(h.images, h.main_image_index) && <img src={imageOf(h.images, h.main_image_index)} alt="" className="h-full w-full object-cover" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-gray-900">{h.name}</p>
                      <p className="text-xs text-gray-500">
                        {h.brand?.name} · {h.b2b_reference || h.reference} {h.source_reference ? `· ${h.source_reference}` : ''} · {STATUS_LABEL[h.status] || h.status}
                      </p>
                    </div>
                    <span className="text-xs text-gray-500">Achat {eur(Number(h.purchase_price) || 0)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {picked.length > 0 && (
            <div className="space-y-2">
              {picked.map((p) => (
                <div key={p.id} className="flex items-center gap-3 rounded-lg border border-gray-200 p-2">
                  <div className="h-12 w-12 flex-shrink-0 overflow-hidden rounded bg-gray-100">
                    {imageOf(p.images, p.main_image_index) && <img src={imageOf(p.images, p.main_image_index)} alt="" className="h-full w-full object-cover" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-900">{p.name}</p>
                    <p className="text-xs text-gray-500">
                      {p.brand?.name} · achat {eur(Number(p.purchase_price) || 0)}
                    </p>
                  </div>
                  <div className="relative w-32">
                    <input
                      value={p.price}
                      onChange={(e) => setPicked((cur) => cur.map((x) => (x.id === p.id ? { ...x, price: e.target.value } : x)))}
                      inputMode="decimal"
                      placeholder="Prix TTC"
                      className="w-full rounded-lg border border-gray-200 py-1.5 pl-2 pr-6 text-right text-sm focus:border-gray-400 focus:outline-none"
                    />
                    <span className="absolute right-2 top-1.5 text-sm text-gray-400">€</span>
                  </div>
                  <button onClick={() => setPicked((cur) => cur.filter((x) => x.id !== p.id))} className="rounded p-1 text-gray-400 hover:bg-gray-100">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
              <p className="text-right text-sm font-semibold text-gray-900">Total TTC (hors certificats) : {eur(total)}</p>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Pseudo Instagram (optionnel)</label>
              <input
                value={handle}
                onChange={(e) => setHandle(e.target.value)}
                placeholder="@client"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Validité du lien</label>
              <select
                value={hours}
                onChange={(e) => setHours(Number(e.target.value))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none"
              >
                {[12, 24, 48, 72, 120, 168].map((h) => (
                  <option key={h} value={h}>
                    {h < 48 ? `${h} h` : `${h / 24} jours`}
                    {h === 48 ? ' (par défaut)' : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="text-xs text-gray-500">
            Les articles sont réservés dès la création (retirés du catalogue B2B, des drops et des enchères) et libérés automatiquement si le lien expire sans paiement.
          </p>
          {error && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-4">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">
            Annuler
          </button>
          <button
            onClick={create}
            disabled={!valid || busy}
            className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Créer le lien
          </button>
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
interface CreditRow {
  id: string;
  amount: number;
  label: string | null;
  counterparty_name: string | null;
  settled_at: string | null;
  emitted_at: string | null;
}

const MarkPaidModal: React.FC<{ link: LinkRow; onClose: () => void; onDone: () => void }> = ({ link, onClose, onDone }) => {
  const [credits, setCredits] = useState<CreditRow[]>([]);
  const [choice, setChoice] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const amount = Number(link.order?.total_amount) || 0;

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('bank_transactions')
        .select('id, amount, label, counterparty_name, settled_at, emitted_at')
        .eq('side', 'credit')
        .eq('reconciliation_status', 'unmatched')
        .is('matched_type', null)
        .gte('emitted_at', new Date(Date.now() - 45 * 86400000).toISOString())
        .order('emitted_at', { ascending: false })
        .limit(200);
      const rows = ((data || []) as CreditRow[]).map((c) => ({ ...c, amount: Number(c.amount) }));
      // Même montant d'abord.
      rows.sort((a, b) => Number(Math.abs(a.amount - amount) > 0.001) - Number(Math.abs(b.amount - amount) > 0.001));
      setCredits(rows);
    })();
  }, [amount]);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc('admin_mark_instagram_paid', {
      p_order_id: link.order?.id,
      p_bank_transaction_id: choice || null,
    });
    if (rpcError) {
      setBusy(false);
      setError(rpcError.message);
      return;
    }
    if (data === 'conflict') {
      setBusy(false);
      setError('Un des articles a été revendu depuis l\'expiration du lien : la commande reste annulée (à rembourser).');
      return;
    }
    // Facture par e-mail tout de suite (sinon le cron s'en charge sous 5 min).
    await supabase.functions.invoke('instagram-order', { body: { action: 'cron' } }).catch(() => null);
    setBusy(false);
    onDone();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl">
        <h3 className="text-lg font-semibold text-gray-900">Marquer payé manuellement</h3>
        <p className="mt-1 text-sm text-gray-600">
          {link.order?.order_number} · {eur(amount)} · réf. {link.payment_reference}. À n'utiliser que si le virement est bien arrivé mais n'a pas été reconnu.
        </p>
        <label className="mt-4 block text-sm font-medium text-gray-700">Virement Qonto correspondant</label>
        <select
          value={choice}
          onChange={(e) => setChoice(e.target.value)}
          className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none"
        >
          <option value="">Aucun (paiement hors Qonto)</option>
          {credits.map((c) => (
            <option key={c.id} value={c.id}>
              {Math.abs(c.amount - amount) < 0.001 ? '✓ ' : ''}
              {eur(c.amount)} · {c.counterparty_name || c.label} · {fmt(c.settled_at || c.emitted_at)}
            </option>
          ))}
        </select>
        {error && <p className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">
            Annuler
          </button>
          <button
            onClick={confirm}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Confirmer le paiement
          </button>
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
export const InstagramSales: React.FC = () => {
  const [rows, setRows] = useState<LinkRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'open' | 'paid' | 'all'>('open');
  const [creating, setCreating] = useState(false);
  const [markPaid, setMarkPaid] = useState<LinkRow | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: fetchError } = await supabase
      .from('instagram_order_links')
      .select(
        '*, order:orders(id, order_number, email, status, total_amount, shipping_address, tracking_number, tracking_url, label_url, ' +
          'items:order_items(product_id, unit_price, product_snapshot))'
      )
      .order('created_at', { ascending: false })
      .limit(500);
    if (fetchError) setError(fetchError.message);
    setRows(((data || []) as unknown) as LinkRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const copyLink = async (token: string) => {
    try {
      await navigator.clipboard.writeText(PUBLIC_BASE + token);
      setCopied(token);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      window.prompt('Lien à copier :', PUBLIC_BASE + token);
    }
  };

  const cancel = async (l: LinkRow) => {
    if (!l.order || !window.confirm(`Annuler ${l.order.order_number} ? Les articles seront remis en stock.`)) return;
    const { error: rpcError } = await supabase.rpc('admin_cancel_instagram_order', { p_order_id: l.order.id });
    if (rpcError) setError(rpcError.message);
    load();
  };

  const visible = useMemo(
    () =>
      rows.filter((r) => {
        const st = stageOf(r);
        if (filter === 'open') return ['link_sent', 'info_submitted', 'transfer_declared', 'payment_conflict'].includes(st);
        if (filter === 'paid') return ['paid', 'shipped', 'delivered'].includes(st);
        return true;
      }),
    [rows, filter]
  );
  const count = (f: 'open' | 'paid') =>
    rows.filter((r) => (f === 'open' ? ['link_sent', 'info_submitted', 'transfer_declared', 'payment_conflict'] : ['paid', 'shipped', 'delivered']).includes(stageOf(r))).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Ventes Instagram</h2>
          <p className="text-sm text-gray-500">Liens de commande envoyés en DM : livraison, virement, facture et suivi sur une seule page.</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Actualiser
          </button>
          <button onClick={() => setCreating(true)} className="flex items-center gap-2 rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800">
            <Plus className="h-4 w-4" /> Nouvelle commande
          </button>
        </div>
      </div>

      <div className="flex w-fit rounded-lg border border-gray-200 bg-white p-0.5 text-sm">
        {(
          [
            ['open', `En cours (${count('open')})`],
            ['paid', `Payées (${count('paid')})`],
            ['all', 'Toutes'],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={`rounded-md px-3 py-1.5 ${filter === k ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <div className="space-y-3">
        {loading && rows.length === 0 ? (
          <p className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-500">Chargement…</p>
        ) : visible.length === 0 ? (
          <p className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-500">Aucune commande.</p>
        ) : (
          visible.map((l) => {
            const st = stageOf(l);
            const o = l.order;
            const sa = o?.shipping_address || {};
            const paid = ['paid', 'shipped', 'delivered'].includes(st);
            const open = ['link_sent', 'info_submitted', 'transfer_declared'].includes(st);
            const cost = (o?.items || []).reduce((s, it) => s + (Number(it.product_snapshot?.purchase_price) || 0), 0);
            return (
              <div key={l.id} className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-gray-900">{o?.order_number}</p>
                      <Badge variant={STAGE[st].variant}>{STAGE[st].label}</Badge>
                      {l.paid_manually && <span className="text-xs text-gray-500">(validé manuellement)</span>}
                    </div>
                    <p className="mt-0.5 text-sm text-gray-600">
                      {l.instagram_handle ? `@${l.instagram_handle}` : 'Client Instagram'}
                      {sa.first_name ? ` · ${sa.first_name} ${sa.last_name || ''}` : ''}
                      {o?.email ? ` · ${o.email}` : ''}
                    </p>
                    <p className="text-xs text-gray-400">
                      Réf. virement {l.payment_reference} · créé {fmt(l.created_at)}
                      {open ? ` · expire ${fmt(l.expires_at)}` : ''}
                      {l.transfer_declared_at ? ` · virement annoncé ${fmt(l.transfer_declared_at)}` : ''}
                      {l.paid_at ? ` · payé ${fmt(l.paid_at)}` : ''}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-semibold text-gray-900">{eur(Number(o?.total_amount) || 0)}</p>
                    <p className="text-xs text-gray-500">
                      achat {eur(cost)}
                      {l.entrupy_product_ids.length > 0 ? ` · ${l.entrupy_product_ids.length} Entrupy` : ''}
                    </p>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  {(o?.items || []).map((it) => {
                    const snap = it.product_snapshot || {};
                    const img = imageOf(snap.images, snap.main_image_index);
                    return (
                      <div key={it.product_id} className="flex items-center gap-2 rounded-lg bg-gray-50 px-2 py-1.5">
                        <div className="h-8 w-8 overflow-hidden rounded bg-gray-100">
                          {img ? <img src={img} alt="" className="h-full w-full object-cover" /> : <Package className="m-2 h-4 w-4 text-gray-300" />}
                        </div>
                        <div className="max-w-[220px]">
                          <p className="truncate text-xs font-medium text-gray-900">{snap.name}</p>
                          <p className="text-xs text-gray-500">
                            {eur(Number(it.unit_price))}
                            {l.entrupy_product_ids.includes(it.product_id) ? ' + Entrupy' : ''}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {st === 'payment_conflict' && (
                  <p className="mt-3 flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
                    <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                    Virement reçu après expiration du lien, alors qu'un article a été revendu. Contacte le client : livraison d'une autre pièce ou remboursement.
                  </p>
                )}

                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
                  <button
                    onClick={() => copyLink(l.token)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                  >
                    {copied === l.token ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                    {copied === l.token ? 'Copié' : 'Copier le lien'}
                  </button>
                  {!paid && st !== 'cancelled' && (
                    <button
                      onClick={() => setMarkPaid(l)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-green-200 px-3 py-1.5 text-sm text-green-700 hover:bg-green-50"
                    >
                      <BadgeEuro className="h-4 w-4" /> Marquer payé
                    </button>
                  )}
                  {open && (
                    <button
                      onClick={() => cancel(l)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
                    >
                      <Ban className="h-4 w-4" /> Annuler
                    </button>
                  )}
                  {paid && o && (
                    <>
                      <div className="w-64">
                        <ShippingLabelButton orderId={o.id} labelUrl={o.label_url} />
                      </div>
                      {o.tracking_number && (
                        <OrderTrackingCell trackingNumber={o.tracking_number} trackingUrl={o.tracking_url} shippingAddress={o.shipping_address} />
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {creating && (
        <CreateOrderPanel
          onClose={() => setCreating(false)}
          onCreated={(token) => {
            setCreating(false);
            load();
            copyLink(token);
          }}
        />
      )}
      {markPaid && (
        <MarkPaidModal
          link={markPaid}
          onClose={() => setMarkPaid(null)}
          onDone={() => {
            setMarkPaid(null);
            load();
          }}
        />
      )}
    </div>
  );
};

export default InstagramSales;
