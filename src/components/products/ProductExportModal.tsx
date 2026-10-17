import React, { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { Download, X, AlertCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { Brand } from '../../hooks/useBrands';
import { generateProductListPdf } from '../../utils/generateProductListPdf';
import { fetchSourcingFulfillmentOrderIds } from '../../utils/sourcingFulfillment';

/**
 * Export de la liste des articles (Excel, CSV ou PDF) depuis « Liste des Produits » :
 * période de création, statuts et marque au choix ; une ligne par article
 * avec ses références (OZË, B2B, fournisseur), marque, titre, état, statut
 * et prix. Lecture par paquets de 1000 (limite de l'API) pour tout exporter.
 */

const STATUS_LABELS: Record<string, string> = {
  draft: 'Brouillon',
  'draft-b2b': 'Brouillon (B2B)',
  'sourced-b2b': 'Sourcing sur mesure',
  'drop-b2b': 'Drop B2B',
  'auction-b2b': 'Enchère',
  'for-sale-online': 'En vente en ligne',
  'for-sale-other-platform': 'Autre plateforme',
  'for-sale-b2b': 'Revendeurs B2B',
  'for-auction-live': 'Live enchères',
  'reserved-b2b': 'Réservé (B2B)',
  'sold-online': 'Vendu en ligne',
  'sold-other-platform': 'Vendu ailleurs',
  'sold-display': 'Vendu - Affiché',
  'sold-auction': 'Vendu (live)',
  'sold-b2b': 'Vendu (B2B)',
  cadeau: 'Cadeau fidélité (en attente)',
  'cadeau-attribue': 'Cadeau attribué',
  'cadeau-livre': 'Cadeau livré',
  archived: 'Archivé',
};

const STATUS_GROUPS: { label: string; statuses: string[] }[] = [
  { label: 'En stock', statuses: ['draft', 'draft-b2b', 'sourced-b2b', 'drop-b2b', 'auction-b2b', 'for-sale-online', 'for-sale-other-platform', 'for-sale-b2b', 'for-auction-live', 'reserved-b2b'] },
  { label: 'Vendus', statuses: ['sold-online', 'sold-other-platform', 'sold-display', 'sold-auction', 'sold-b2b'] },
  { label: 'Cadeaux & archivés', statuses: ['cadeau', 'cadeau-attribue', 'cadeau-livre', 'archived'] },
];
const ALL_STATUSES = STATUS_GROUPS.flatMap((g) => g.statuses);

const CONDITION_LABELS: Record<string, string> = {
  neuf: 'Neuf', excellent: 'Excellent', 'very-good': 'Très bon', good: 'Bon', fair: 'Correct',
};
const formatCondition = (c: string | null) => (!c ? '' : CONDITION_LABELS[c] || `Grade ${c}`);

const toInput = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

type Preset = 'month' | 'last-month' | '30d' | 'year' | 'all';
const presetRange = (preset: Preset): { from: string; to: string } => {
  const now = new Date();
  const today = toInput(now);
  switch (preset) {
    case 'month':
      return { from: toInput(new Date(now.getFullYear(), now.getMonth(), 1)), to: today };
    case 'last-month':
      return {
        from: toInput(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
        to: toInput(new Date(now.getFullYear(), now.getMonth(), 0)),
      };
    case '30d':
      return { from: toInput(new Date(now.getTime() - 29 * 86_400_000)), to: today };
    case 'year':
      return { from: toInput(new Date(now.getFullYear(), 0, 1)), to: today };
    default:
      return { from: '', to: '' };
  }
};

type ExportRow = {
  created_at: string;
  product_code: string | null;
  reference: string | null;
  b2b_reference: string | null;
  source_reference: string | null;
  source_platform: string | null;
  name: string;
  condition: string | null;
  status: string;
  id: string;
  purchase_price: number | null;
  sale_price: number | null;
  original_price: number | null;
  /** Prix réellement encaissé (voir loadSoldPrices), null si pas vendu ou inconnu. */
  sold_price?: number | null;
  /** true : prix vendu = prix revendeur de la pièce sur sa mission de sourcing sur mesure. */
  sold_via_sourcing?: boolean;
  /** Par où l'article est parti (voir loadSaleChannels). */
  sale_channel?: string;
  /** Premier prix affiché et sa source (voir loadSaleChannels). */
  first_price?: number | null;
  first_price_source?: string;
  auction_start_price?: number | null;
  auction_final_price?: number | null;
  colors: string[] | null;
  material: string | null;
  serial_number: string | null;
  barcode: string | null;
  brand: { name: string } | null;
  category: { name: string } | null;
};

/** Prix réellement encaissé par article vendu : ligne de commande payée et
 * non annulée (site web, B2B, enchère B2B — commandes AUC-…), sinon, pour une
 * vente en Live (pas de commande), le prix enregistré à la vente, comme en
 * Comptabilité. Une pièce de sourcing sur mesure prend toujours son « prix
 * revendeur » sur la mission (prix imposé, sinon floor(coût × (1 + marge de la
 * mission)), comme useSourcingMissions). Les autres ventes hors plateforme
 * restent sans prix vendu. */
type SoldPrice = { price: number; source: 'order' | 'live' | 'sourcing'; orderNumber?: string; orderChannel?: string };

const loadSoldPrices = async (rows: ExportRow[]): Promise<Map<string, SoldPrice>> => {
  const prices = new Map<string, SoldPrice>();
  const ids = rows.map((r) => r.id);
  // Commandes de suivi de sourcing (0197/0204) : le prix vendu reste celui de la mission.
  const fulfillmentOrderIds = await fetchSourcingFulfillmentOrderIds();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase
      .from('order_items')
      .select('product_id, line_total, order:orders!inner(id, status, payment_status, created_at, order_number, order_channel)')
      .in('product_id', ids.slice(i, i + 200))
      .eq('status', 'active');
    if (error) throw new Error(error.message);
    const items = (data || []) as unknown as { product_id: string; line_total: number; order: { id: string; status: string; payment_status: string; created_at: string; order_number: string | null; order_channel: string | null } }[];
    const latest = new Map<string, string>();
    for (const it of items) {
      const o = it.order;
      const paid = !['cancelled', 'canceled'].includes(o.status)
        && (['paid', 'succeeded'].includes(o.payment_status) || ['confirmed', 'shipped', 'delivered'].includes(o.status));
      if (!paid || fulfillmentOrderIds.has(o.id)) continue;
      if (latest.has(it.product_id) && latest.get(it.product_id)! > o.created_at) continue;
      latest.set(it.product_id, o.created_at);
      prices.set(it.product_id, { price: Number(it.line_total) || 0, source: 'order', orderNumber: o.order_number || undefined, orderChannel: o.order_channel || undefined });
    }

    const { data: sourced, error: sourcedError } = await supabase
      .from('b2b_sourcing_items')
      .select('product_id, cost_price, custom_reseller_price, mission:b2b_sourcing_missions!inner(status, advance_amount, allocated_cost_budget)')
      .in('product_id', ids.slice(i, i + 200))
      .neq('status', 'cancelled');
    if (sourcedError) throw new Error(sourcedError.message);
    for (const it of (sourced || []) as unknown as {
      product_id: string;
      cost_price: number | null;
      custom_reseller_price: number | null;
      mission: { status: string; advance_amount: number; allocated_cost_budget: number };
    }[]) {
      if (it.mission.status === 'cancelled') continue;
      const advance = Number(it.mission.advance_amount);
      const margin = advance > 0 ? ((advance - Number(it.mission.allocated_cost_budget)) / advance) * 100 : null;
      const price = it.custom_reseller_price != null
        ? Number(it.custom_reseller_price)
        : it.cost_price != null && margin != null
          ? Math.floor(Number(it.cost_price) * (1 + margin / 100))
          : null;
      if (price != null) prices.set(it.product_id, { price, source: 'sourcing' });
    }
  }
  for (const r of rows) {
    if (!prices.has(r.id) && r.status === 'sold-auction' && r.sale_price != null) {
      prices.set(r.id, { price: Number(r.sale_price), source: 'live' });
    }
  }
  return prices;
};

/**
 * Canal de vente et premier prix affiché de chaque article.
 *   - Canal : enchère B2B (lot adjugé), sourcing sur mesure, drop, vente
 *     directe catalogue B2B, site web, Live, autre plateforme… d'après la
 *     commande payée retenue (préfixe AUC- / SRC-) et l'appartenance à un
 *     drop ou une mission.
 *   - Premier prix affiché : le prix d'avant la première baisse programmée
 *     (b2b_price_changes, 0200), sinon le prix d'origine (original_price),
 *     sinon le prix de départ d'enchère pour un lot (sale_price est écrasé
 *     par le prix adjugé à la clôture), sinon le prix de vente actuel.
 */
const loadSaleChannels = async (rows: ExportRow[], sold: Map<string, SoldPrice>) => {
  const ids = rows.map((r) => r.id);
  const auctions = new Map<string, { start: number; final: number | null; sold: boolean }>();
  const firstChange = new Map<string, number>();
  const inDrop = new Set<string>();
  for (let i = 0; i < ids.length; i += 200) {
    const slice = ids.slice(i, i + 200);
    const [auctionRes, changesRes] = await Promise.all([
      supabase.from('auction_items').select('product_id, start_price, current_price, status, created_at').in('product_id', slice).neq('status', 'cancelled'),
      supabase.from('b2b_price_changes').select('product_id, old_price, applied_at').in('product_id', slice).eq('status', 'applied').order('applied_at', { ascending: true }),
    ]);
    for (const a of (auctionRes.data || []) as { product_id: string; start_price: number; current_price: number | null; status: string }[]) {
      // Plusieurs passages en enchère : on garde le lot adjugé s'il y en a un.
      const prev = auctions.get(a.product_id);
      if (prev?.sold && a.status !== 'sold') continue;
      auctions.set(a.product_id, { start: Number(a.start_price), final: a.status === 'sold' ? Number(a.current_price) : null, sold: a.status === 'sold' });
    }
    for (const c of (changesRes.data || []) as { product_id: string; old_price: number | null }[]) {
      if (!firstChange.has(c.product_id) && c.old_price != null) firstChange.set(c.product_id, Number(c.old_price));
    }
  }
  const { data: drops } = await supabase.from('drops').select('product_ids').neq('status', 'annule');
  for (const d of (drops || []) as { product_ids: string[] | null }[]) for (const id of d.product_ids || []) inDrop.add(id);

  for (const r of rows) {
    const s = sold.get(r.id);
    const auction = auctions.get(r.id);
    const isSold = r.status.startsWith('sold') || s != null;
    let channel = '';
    if (s?.source === 'sourcing' || s?.orderNumber?.startsWith('SRC-')) channel = 'Sourcing sur mesure';
    else if (s?.orderNumber?.startsWith('AUC-') || auction?.sold) channel = 'Enchère B2B';
    else if (r.status === 'sold-auction') channel = 'Live';
    else if (r.status === 'sold-other-platform') channel = 'Autre plateforme';
    else if (r.status === 'sold-display') channel = 'Vente affichée';
    else if (s?.orderChannel === 'web' || r.status === 'sold-online') channel = 'Site web';
    else if (isSold && inDrop.has(r.id)) channel = 'Drop B2B';
    else if (isSold) channel = 'Vente directe B2B (catalogue)';
    r.sale_channel = channel;

    r.auction_start_price = auction ? auction.start : null;
    r.auction_final_price = auction?.final ?? null;

    if (firstChange.has(r.id)) {
      r.first_price = firstChange.get(r.id)!;
      r.first_price_source = 'Avant baisse programmée';
    } else if (r.original_price != null) {
      r.first_price = Number(r.original_price);
      r.first_price_source = 'Prix d\x27origine';
    } else if (auction) {
      r.first_price = auction.start;
      r.first_price_source = 'Départ enchère';
    } else {
      r.first_price = r.sale_price;
      r.first_price_source = r.sale_price != null ? 'Prix de vente' : '';
    }
  }
};

interface ProductExportModalProps {
  brands: Brand[];
  onClose: () => void;
}

export const ProductExportModal: React.FC<ProductExportModalProps> = ({ brands, onClose }) => {
  const [preset, setPreset] = useState<Preset | 'custom'>('month');
  const [from, setFrom] = useState(() => presetRange('month').from);
  const [to, setTo] = useState(() => presetRange('month').to);
  const [statuses, setStatuses] = useState<Set<string>>(new Set(ALL_STATUSES));
  const [brandId, setBrandId] = useState('');
  const [format, setFormat] = useState<'xlsx' | 'csv' | 'pdf'>('xlsx');
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [count, setCount] = useState<number | null>(null);

  const applyPreset = (p: Preset) => {
    setPreset(p);
    const r = presetRange(p);
    setFrom(r.from);
    setTo(r.to);
  };

  const sortedBrands = useMemo(() => [...brands].sort((a, b) => a.name.localeCompare(b.name)), [brands]);

  // Requête commune au comptage et à l'export.
  const buildQuery = (select: string, head = false) => {
    let q = supabase.from('products').select(select, head ? { count: 'exact', head: true } : undefined);
    if (from) q = q.gte('created_at', new Date(`${from}T00:00:00`).toISOString());
    if (to) q = q.lte('created_at', new Date(`${to}T23:59:59.999`).toISOString());
    if (statuses.size < ALL_STATUSES.length) q = q.in('status', [...statuses]);
    if (brandId) q = q.eq('brand_id', brandId);
    return q;
  };

  // Aperçu du nombre d'articles concernés à chaque changement de filtre.
  useEffect(() => {
    let cancelled = false;
    setCount(null);
    if (statuses.size === 0) {
      setCount(0);
      return;
    }
    buildQuery('id', true).then(({ count: c }) => {
      if (!cancelled) setCount(c ?? 0);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, statuses, brandId]);

  const toggleStatus = (s: string) =>
    setStatuses((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });

  const toggleGroup = (group: string[]) =>
    setStatuses((prev) => {
      const next = new Set(prev);
      const allOn = group.every((s) => next.has(s));
      group.forEach((s) => (allOn ? next.delete(s) : next.add(s)));
      return next;
    });

  const handleExport = async () => {
    if (statuses.size === 0) {
      setError('Sélectionnez au moins un statut.');
      return;
    }
    setExporting(true);
    setError(null);
    try {
      const rows: ExportRow[] = [];
      const PAGE = 1000;
      for (let start = 0; ; start += PAGE) {
        const { data, error: fetchError } = await buildQuery(
          'id, created_at, product_code, reference, b2b_reference, source_reference, source_platform, name, condition, status, purchase_price, sale_price, original_price, colors, material, serial_number, barcode, brand:brands(name), category:categories(name)'
        )
          .order('created_at', { ascending: true })
          .range(start, start + PAGE - 1);
        if (fetchError) throw new Error(fetchError.message);
        rows.push(...((data || []) as unknown as ExportRow[]));
        if (!data || data.length < PAGE) break;
      }
      const soldPrices = await loadSoldPrices(rows);
      await loadSaleChannels(rows, soldPrices);
      for (const r of rows) {
        const sold = soldPrices.get(r.id);
        r.sold_price = sold?.price ?? null;
        r.sold_via_sourcing = sold?.source === 'sourcing';
      }

      const header = [
        'Date de création', 'Code produit', 'Référence OZË', 'Référence B2B', 'Référence fournisseur', 'Plateforme source',
        'Marque', 'Catégorie', 'Titre', 'État', 'Statut', 'Canal de vente', "Prix d'achat (€)", 'Premier prix affiché (€)', 'Source du premier prix', 'Prix de vente (€)', 'Prix de départ enchère (€)', 'Prix adjugé (€)', 'Prix vendu (€)', 'Origine du prix vendu', 'Ancien prix (€)',
        'Marge (€)', 'Couleurs', 'Matière', 'N° de série', 'Code-barres',
      ];
      const body = rows.map((r) => {
        const margin = r.sale_price != null && r.purchase_price != null ? Math.round((r.sale_price - r.purchase_price) * 100) / 100 : '';
        return [
          new Date(r.created_at).toLocaleDateString('fr-FR'),
          r.product_code || '',
          r.reference || '',
          r.b2b_reference || '',
          r.source_reference || '',
          r.source_platform || '',
          r.brand?.name || '',
          r.category?.name || '',
          r.name,
          formatCondition(r.condition),
          STATUS_LABELS[r.status] || r.status,
          r.sale_channel || '',
          r.purchase_price ?? '',
          r.first_price ?? '',
          r.first_price_source || '',
          r.sale_price ?? '',
          r.auction_start_price ?? '',
          r.auction_final_price ?? '',
          r.sold_price ?? '',
          r.sold_price == null ? '' : r.sold_via_sourcing ? 'Sourcing sur mesure' : r.status === 'sold-auction' ? 'Live' : 'Commande',
          r.original_price ?? '',
          margin,
          (r.colors || []).join(', '),
          r.material || '',
          r.serial_number || '',
          r.barcode || '',
        ];
      });

      const ws = XLSX.utils.aoa_to_sheet([header, ...body]);
      ws['!cols'] = header.map((h) => ({ wch: Math.max(12, h.length + 2) }));
      const period = from || to ? `du_${from || 'debut'}_au_${to || 'aujourdhui'}` : 'tous';
      const fileBase = `articles_${period}`;
      if (format === 'pdf') {
        const frDate = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('fr-FR');
        const periodLabel = from && to
          ? `du ${frDate(from)} au ${frDate(to)}`
          : from ? `depuis le ${frDate(from)}` : to ? `jusqu'au ${frDate(to)}` : 'depuis le début';
        // Statuts : « tous », des groupes entiers (« en stock, vendus »), sinon la liste détaillée.
        const fullGroups = STATUS_GROUPS.filter((g) => g.statuses.every((st) => statuses.has(st)));
        const onlyFullGroups = [...statuses].every((st) => fullGroups.some((g) => g.statuses.includes(st)));
        const statusLabel = statuses.size === ALL_STATUSES.length
          ? 'tous les statuts'
          : onlyFullGroups
            ? fullGroups.map((g) => g.label.toLowerCase()).join(', ')
            : [...statuses].map((st) => STATUS_LABELS[st] || st).join(', ');
        const brandLabel = brandId ? brands.find((b) => b.id === brandId)?.name || 'marque choisie' : 'toutes les marques';
        await generateProductListPdf({
          rows: rows.map((r) => ({
            date: new Date(r.created_at).toLocaleDateString('fr-FR'),
            supplierRef: r.source_reference || '',
            platform: r.source_platform || '',
            brand: r.brand?.name || '',
            title: r.name,
            condition: formatCondition(r.condition),
            status: STATUS_LABELS[r.status] || r.status,
            purchasePrice: r.purchase_price,
            salePrice: r.sale_price,
            soldPrice: r.sold_price ?? null,
            soldViaSourcing: Boolean(r.sold_via_sourcing),
          })),
          periodLabel,
          filtersLabel: `${statusLabel} · ${brandLabel}`,
          fileName: `${fileBase}.pdf`,
        });
      } else if (format === 'csv') {
        // Point-virgule + BOM : ouverture directe et correcte dans Excel (version française).
        const csv = XLSX.utils.sheet_to_csv(ws, { FS: ';' });
        const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${fileBase}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      } else {
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Articles');
        XLSX.writeFile(wb, `${fileBase}.xlsx`);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export impossible');
    } finally {
      setExporting(false);
    }
  };

  const presets: { id: Preset; label: string }[] = [
    { id: 'month', label: 'Ce mois' },
    { id: 'last-month', label: 'Mois dernier' },
    { id: '30d', label: '30 derniers jours' },
    { id: 'year', label: 'Cette année' },
    { id: 'all', label: 'Tout' },
  ];

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative w-full max-w-2xl rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between border-b border-gray-100 p-5">
            <h3 className="flex items-center gap-2 text-base font-semibold text-gray-900">
              <Download className="h-4 w-4" /> Exporter les articles
            </h3>
            <button onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:text-gray-600">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="space-y-5 p-5">
            {/* Période */}
            <div>
              <p className="mb-2 text-sm font-medium text-gray-700">Articles créés</p>
              <div className="mb-3 flex flex-wrap gap-2">
                {presets.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => applyPreset(p.id)}
                    className={`rounded-lg border px-3 py-1.5 text-sm ${preset === p.id ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 text-gray-700 hover:bg-gray-50'}`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-3 text-sm text-gray-600">
                <label className="flex items-center gap-2">
                  du
                  <input
                    type="date"
                    value={from}
                    onChange={(e) => { setFrom(e.target.value); setPreset('custom'); }}
                    className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:border-gray-400 focus:outline-none"
                  />
                </label>
                <label className="flex items-center gap-2">
                  au
                  <input
                    type="date"
                    value={to}
                    onChange={(e) => { setTo(e.target.value); setPreset('custom'); }}
                    className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:border-gray-400 focus:outline-none"
                  />
                </label>
                {!from && !to && <span className="text-xs text-gray-400">depuis le début</span>}
              </div>
            </div>

            {/* Statuts */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-medium text-gray-700">Statuts</p>
                <button
                  onClick={() => setStatuses(statuses.size === ALL_STATUSES.length ? new Set() : new Set(ALL_STATUSES))}
                  className="text-xs text-gray-500 underline hover:text-gray-900"
                >
                  {statuses.size === ALL_STATUSES.length ? 'Tout décocher' : 'Tout cocher'}
                </button>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {STATUS_GROUPS.map((g) => (
                  <div key={g.label} className="rounded-lg border border-gray-100 p-3">
                    <label className="mb-1.5 flex cursor-pointer items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                      <input
                        type="checkbox"
                        checked={g.statuses.every((s) => statuses.has(s))}
                        onChange={() => toggleGroup(g.statuses)}
                        className="rounded"
                      />
                      {g.label}
                    </label>
                    <div className="space-y-1">
                      {g.statuses.map((s) => (
                        <label key={s} className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
                          <input type="checkbox" checked={statuses.has(s)} onChange={() => toggleStatus(s)} className="rounded" />
                          {STATUS_LABELS[s]}
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Marque + format */}
            <div className="flex flex-wrap items-end gap-4">
              <label className="text-sm text-gray-700">
                <span className="mb-1 block font-medium">Marque</span>
                <select
                  value={brandId}
                  onChange={(e) => setBrandId(e.target.value)}
                  className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:border-gray-400 focus:outline-none"
                >
                  <option value="">Toutes les marques</option>
                  {sortedBrands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </label>
              <div className="text-sm text-gray-700">
                <span className="mb-1 block font-medium">Format</span>
                <div className="flex gap-2">
                  {([['xlsx', 'Excel (.xlsx)'], ['csv', 'CSV'], ['pdf', 'PDF']] as const).map(([f, label]) => (
                    <button
                      key={f}
                      onClick={() => setFormat(f)}
                      className={`rounded-lg border px-3 py-2 text-sm ${format === f ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 text-gray-700 hover:bg-gray-50'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <p className="text-xs text-gray-500">
              Colonnes : date de création, code produit, références OZË / B2B / fournisseur, plateforme, marque, catégorie, titre,
              état, statut, canal de vente, prix d'achat, premier prix affiché, prix de vente, prix de départ et prix adjugé d'enchère, prix vendu,
              ancien prix, marge, couleurs, matière, n° de série, code-barres (Excel / CSV).
            </p>

            {error && (
              <p className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" /> {error}
              </p>
            )}
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-gray-100 p-5">
            <p className="text-sm text-gray-600">
              {count === null ? 'Calcul…' : <><strong className="text-gray-900">{count}</strong> article{count > 1 ? 's' : ''} à exporter</>}
            </p>
            <div className="flex gap-2">
              <button onClick={onClose} className="rounded-lg bg-gray-100 px-4 py-2 text-sm text-gray-700 hover:bg-gray-200">
                Annuler
              </button>
              <button
                onClick={handleExport}
                disabled={exporting || count === 0}
                className="flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
              >
                <Download className="h-4 w-4" /> {exporting ? 'Export en cours…' : 'Exporter'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProductExportModal;
