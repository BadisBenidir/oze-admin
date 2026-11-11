import { useState } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from '../lib/supabase';
import { fetchSourcingFulfillmentOrderIds } from '../utils/sourcingFulfillment';
import { isCountedCharge } from '../utils/accountingCalc';

export type SalesJournalScope = 'all' | 'web' | 'b2b' | 'sourcing' | 'manual';

interface SalesJournalRow {
  date: Date;
  reference: string;
  client: string;
  amountTTC: number;
}

interface WebOrderRow {
  order_number: string;
  status: string;
  payment_status: string;
  total_amount: number;
  created_at: string;
  email: string | null;
  shipping_address?: { name?: string; firstName?: string; lastName?: string } | null;
  billing_address?: { name?: string; firstName?: string; lastName?: string } | null;
}

interface ProfileRef {
  first_name: string | null;
  last_name: string | null;
  email: string | null;
}

interface B2BOrderRow {
  order_number: string;
  status: string;
  payment_status: string;
  total_amount: number;
  created_at: string;
  reseller: { company_name: string } | null;
  placed_by: ProfileRef | null;
}

interface SourcingMissionRow {
  reference: string | null;
  title: string;
  advance_amount: number;
  paid_at: string;
  reseller: { company_name: string } | null;
  requester: ProfileRef | null;
}

// Même règle "encaissée" que useAccountingRawData.ts (isOrderPaid) — exclut
// explicitement les commandes annulées, dont payment_status reste 'paid'
// (seul un remboursement suit l'annulation, jamais un reset de ce champ).
const isOrderPaid = (o: { payment_status: string; status: string }): boolean =>
  !['cancelled', 'canceled'].includes(o.status) &&
  (['paid', 'succeeded'].includes(o.payment_status) || ['confirmed', 'shipped', 'delivered'].includes(o.status));

// Nom complet d'un sous-compte, avec repli sur l'email si le nom est vide —
// jamais le nom de l'entreprise ici, qui reste un dernier recours à part
// (voir sites d'appel ci-dessous) : la facture est émise au nom de la
// personne physique qui a passé la commande / demandé la mission, pas de
// l'entreprise dans son ensemble.
const profileDisplayName = (profile: ProfileRef | null | undefined): string => {
  if (!profile) return '';
  const fullName = `${profile.first_name || ''} ${profile.last_name || ''}`.trim();
  return fullName || profile.email || '';
};

const addressDisplayName = (addr: { name?: string; firstName?: string; lastName?: string } | null | undefined): string => {
  if (!addr) return '';
  return addr.name || `${addr.firstName || ''} ${addr.lastName || ''}`.trim();
};

export interface SalesJournalResult {
  success: boolean;
  rowsCount?: number;
  error?: string;
}

/**
 * Génère et télécharge le "Journal des Ventes" (.xlsx) : commandes web
 * (order_channel='web'), commandes B2B (order_channel='b2b') et avances de
 * sourcing sur mesure (b2b_sourcing_missions.advance_amount, paid_at dans
 * l'intervalle) et autres revenus saisis à la main (manual_revenues, 0275),
 * triées chronologiquement.
 *
 * OZË Paris est en franchise en base de TVA (article 293 B du CGI, voir
 * config/legal.ts et Terms.tsx) : aucune TVA n'est facturée sur ces ventes,
 * donc Base HT = Prix Encaissé TTC et TVA Collectée = 0 sur chaque ligne —
 * corrige une version antérieure de cet export qui appliquait à tort un
 * taux de 20% (confirmé depuis : pas de régime de marge NI de TVA standard
 * tant que ce statut de franchise s'applique).
 */
export const useSalesJournalExport = () => {
  const [exporting, setExporting] = useState(false);

  const exportJournal = async (startDate: string, endDate: string, scope: SalesJournalScope): Promise<SalesJournalResult> => {
    setExporting(true);
    try {
      if (!startDate) throw new Error('La date de début est requise');
      const effectiveEndDate = endDate || new Date().toISOString().slice(0, 10);
      const startIso = new Date(`${startDate}T00:00:00`).toISOString();
      const endIso = new Date(`${effectiveEndDate}T23:59:59.999`).toISOString();

      const rows: SalesJournalRow[] = [];

      if (scope === 'all' || scope === 'web') {
        const { data, error } = await supabase
          .from('orders')
          .select('order_number, status, payment_status, total_amount, created_at, email, shipping_address, billing_address')
          .eq('order_channel', 'web')
          .is('archived_at', null)
          .gte('created_at', startIso)
          .lte('created_at', endIso);
        if (error) throw new Error(error.message);
        for (const o of (data || []) as WebOrderRow[]) {
          if (!isOrderPaid(o)) continue;
          // Priorité : adresse de livraison, puis de facturation, puis
          // email (toujours présent sur une commande) — 'Client inconnu'
          // n'est plus qu'un tout dernier repli, en pratique inatteignable.
          const client = addressDisplayName(o.shipping_address) || addressDisplayName(o.billing_address) || o.email || 'Client inconnu';
          rows.push({ date: new Date(o.created_at), reference: o.order_number, client, amountTTC: Number(o.total_amount) || 0 });
        }
      }

      if (scope === 'all' || scope === 'b2b') {
        const { data, error } = await supabase
          .from('orders')
          .select('id, order_number, status, payment_status, total_amount, created_at, reseller:resellers(company_name), placed_by:profiles!placed_by_profile_id(first_name, last_name, email)')
          .eq('order_channel', 'b2b')
          .is('archived_at', null)
          .gte('created_at', startIso)
          .lte('created_at', endIso);
        if (error) throw new Error(error.message);
        // Commandes de suivi des missions clôturées (0197/0204) : la vente
        // figure déjà au journal via l'avance de la mission.
        const fulfillmentOrderIds = await fetchSourcingFulfillmentOrderIds();
        for (const o of (data || []) as unknown as (B2BOrderRow & { id: string })[]) {
          if (!isOrderPaid(o) || fulfillmentOrderIds.has(o.id)) continue;
          // La facture porte le nom du sous-compte qui a passé la commande,
          // pas celui de l'entreprise — le nom de l'entreprise ne sert que
          // de tout dernier repli (commandes antérieures à
          // placed_by_profile_id, voir useB2BOrders.ts).
          const client = profileDisplayName(o.placed_by) || o.reseller?.company_name || 'Revendeur';
          rows.push({ date: new Date(o.created_at), reference: o.order_number, client, amountTTC: Number(o.total_amount) || 0 });
        }
      }

      if (scope === 'all' || scope === 'sourcing') {
        const primary = await supabase
          .from('b2b_sourcing_missions')
          .select('reference, title, advance_amount, paid_at, status, reseller:resellers(company_name), requester:profiles!user_id(first_name, last_name, email)')
          .not('paid_at', 'is', null)
          .neq('status', 'cancelled')
          .gte('paid_at', startIso)
          .lte('paid_at', endIso);

        let sourcingData = primary.data;
        let sourcingError = primary.error;

        // Repli si la migration 0096 (colonne reference) n'est pas encore
        // appliquée sur cet environnement — le titre libre de la mission
        // sert alors de "N° Commande / Facture", comme avant 0096, plutôt
        // que de faire échouer tout l'export.
        if (sourcingError?.message?.includes('reference')) {
          const fallback = await supabase
            .from('b2b_sourcing_missions')
            .select('title, advance_amount, paid_at, status, reseller:resellers(company_name), requester:profiles!user_id(first_name, last_name, email)')
            .not('paid_at', 'is', null)
            .neq('status', 'cancelled')
            .gte('paid_at', startIso)
            .lte('paid_at', endIso);
          sourcingData = (fallback.data || []).map((m) => ({ ...m, reference: null })) as typeof sourcingData;
          sourcingError = fallback.error;
        }

        if (sourcingError) throw new Error(sourcingError.message);
        for (const m of (sourcingData || []) as unknown as SourcingMissionRow[]) {
          const client = profileDisplayName(m.requester) || m.reseller?.company_name || 'Revendeur';
          rows.push({ date: new Date(m.paid_at), reference: m.reference || m.title, client, amountTTC: Number(m.advance_amount) || 0 });
        }
      }

      // Autres revenus saisis à la main (0275) : virements, PayPal, prestations.
      if (scope === 'all' || scope === 'manual') {
        const { data, error } = await supabase
          .from('manual_revenues')
          .select('revenue_date, client_name, label, amount')
          .gte('revenue_date', startDate)
          .lte('revenue_date', effectiveEndDate);
        if (error) throw new Error(error.message);
        for (const r of (data || []) as { revenue_date: string; client_name: string; label: string; amount: number }[]) {
          rows.push({ date: new Date(`${r.revenue_date}T12:00:00`), reference: r.label, client: r.client_name, amountTTC: Number(r.amount) || 0 });
        }
      }

      // Charges externes validées (0276) : feuilles « Charges » et « Synthèse »
      // du périmètre complet uniquement.
      let charges: { spent_at: string; label: string; category: string | null; amount: number; bank_transaction_id: string | null; review_status: string }[] = [];
      if (scope === 'all') {
        const { data, error } = await supabase
          .from('expenses')
          .select('spent_at, label, category, amount, bank_transaction_id, review_status')
          .gte('spent_at', startDate)
          .lte('spent_at', effectiveEndDate)
          .order('spent_at');
        if (error) throw new Error(error.message);
        charges = ((data || []) as typeof charges).filter(isCountedCharge);
      }

      if (rows.length === 0 && charges.length === 0) {
        return { success: false, error: 'Aucune vente trouvée sur cette période.' };
      }

      rows.sort((a, b) => a.date.getTime() - b.date.getTime());

      const dateStr = (d: Date) => d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
      const header = ['Date', 'N° Commande / Facture', 'Client', 'Prix Encaissé TTC', 'Base HT', 'TVA Collectée', 'Régime'];
      const aoa: (string | number)[][] = [
        header,
        // Franchise en base : rien à extraire, la base HT est le montant
        // encaissé lui-même et la TVA collectée est nulle sur chaque ligne.
        ...rows.map((r) => [dateStr(r.date), r.reference, r.client, r.amountTTC, r.amountTTC, 0, 'Franchise en base (art. 293 B) — TVA non applicable']),
      ];

      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws['!cols'] = [{ wch: 12 }, { wch: 26 }, { wch: 28 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 42 }];

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Ventes');

      if (scope === 'all') {
        const chargesSheet = XLSX.utils.aoa_to_sheet([
          ['Date', 'Catégorie', 'Libellé', 'Montant', 'Source'],
          ...charges.map((c) => [dateStr(new Date(`${c.spent_at}T12:00:00`)), c.category || 'Sans catégorie', c.label, Number(c.amount) || 0, c.bank_transaction_id ? 'Qonto' : 'Saisie']),
        ]);
        chargesSheet['!cols'] = [{ wch: 12 }, { wch: 28 }, { wch: 40 }, { wch: 14 }, { wch: 10 }];
        XLSX.utils.book_append_sheet(wb, chargesSheet, 'Charges');

        const byCategory = new Map<string, number>();
        for (const c of charges) byCategory.set(c.category || 'Sans catégorie', (byCategory.get(c.category || 'Sans catégorie') || 0) + (Number(c.amount) || 0));
        const sales = rows.reduce((t, r) => t + r.amountTTC, 0);
        const chargesTotal = charges.reduce((t, c) => t + (Number(c.amount) || 0), 0);
        const summary = XLSX.utils.aoa_to_sheet([
          ['Synthèse', `du ${startDate} au ${effectiveEndDate}`],
          [],
          ['CA encaissé (journal des ventes)', sales],
          [],
          ['Charges externes par catégorie', ''],
          ...[...byCategory.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, v]),
          ['Total charges externes', chargesTotal],
          [],
          ["Résultat net = marge brute (CA − coût d'achat produits − Sendcloud) − charges externes : voir Comptabilité → Dashboard Global.", ''],
        ]);
        summary['!cols'] = [{ wch: 44 }, { wch: 18 }];
        XLSX.utils.book_append_sheet(wb, summary, 'Synthèse');
      }
      XLSX.writeFile(wb, `journal_ventes_du_${startDate}_au_${effectiveEndDate}.xlsx`);

      return { success: true, rowsCount: rows.length };
    } catch (err) {
      console.error('Erreur export journal des ventes:', err);
      return { success: false, error: err instanceof Error ? err.message : 'Erreur inconnue' };
    } finally {
      setExporting(false);
    }
  };

  return { exporting, exportJournal };
};
