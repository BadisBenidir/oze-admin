import { useState } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from '../lib/supabase';

export type SalesJournalScope = 'all' | 'web' | 'b2b' | 'sourcing';

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
  reference: string;
  advance_amount: number;
  paid_at: string;
  reseller: { company_name: string } | null;
  requester: ProfileRef | null;
}

// Même règle "encaissée" que Accounting.tsx (paymentPaid) — une seule
// définition ici pour ne pas la dupliquer/dévier entre les deux écrans.
const isOrderPaid = (o: { payment_status: string; status: string }): boolean =>
  ['paid', 'succeeded'].includes(o.payment_status) || ['confirmed', 'shipped', 'delivered'].includes(o.status);

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
 * l'intervalle), triées chronologiquement. Colonnes Base HT / TVA Collectée
 * en formules Excel natives, régime standard 20% (confirmé — aucun régime
 * de marge fiscale n'existe ailleurs dans ce repo, ne pas en supposer un).
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
          .select('order_number, status, payment_status, total_amount, created_at, reseller:resellers(company_name), placed_by:profiles!placed_by_profile_id(first_name, last_name, email)')
          .eq('order_channel', 'b2b')
          .gte('created_at', startIso)
          .lte('created_at', endIso);
        if (error) throw new Error(error.message);
        for (const o of (data || []) as unknown as B2BOrderRow[]) {
          if (!isOrderPaid(o)) continue;
          // La facture porte le nom du sous-compte qui a passé la commande,
          // pas celui de l'entreprise — le nom de l'entreprise ne sert que
          // de tout dernier repli (commandes antérieures à
          // placed_by_profile_id, voir useB2BOrders.ts).
          const client = profileDisplayName(o.placed_by) || o.reseller?.company_name || 'Revendeur';
          rows.push({ date: new Date(o.created_at), reference: o.order_number, client, amountTTC: Number(o.total_amount) || 0 });
        }
      }

      if (scope === 'all' || scope === 'sourcing') {
        const { data, error } = await supabase
          .from('b2b_sourcing_missions')
          .select('reference, advance_amount, paid_at, status, reseller:resellers(company_name), requester:profiles!user_id(first_name, last_name, email)')
          .not('paid_at', 'is', null)
          .neq('status', 'cancelled')
          .gte('paid_at', startIso)
          .lte('paid_at', endIso);
        if (error) throw new Error(error.message);
        for (const m of (data || []) as unknown as SourcingMissionRow[]) {
          const client = profileDisplayName(m.requester) || m.reseller?.company_name || 'Revendeur';
          rows.push({ date: new Date(m.paid_at), reference: m.reference, client, amountTTC: Number(m.advance_amount) || 0 });
        }
      }

      if (rows.length === 0) {
        return { success: false, error: 'Aucune vente trouvée sur cette période.' };
      }

      rows.sort((a, b) => a.date.getTime() - b.date.getTime());

      const dateStr = (d: Date) => d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
      const header = ['Date', 'N° Commande / Facture', 'Client', 'Prix Encaissé TTC', 'Base HT', 'TVA Collectée'];
      const aoa: (string | number)[][] = [
        header,
        ...rows.map((r) => [dateStr(r.date), r.reference, r.client, r.amountTTC, 0, 0]),
      ];

      const ws = XLSX.utils.aoa_to_sheet(aoa);
      // Base HT / TVA Collectée en formules natives (régime standard 20%,
      // confirmé par l'utilisateur) — éditables/vérifiables directement par
      // le comptable dans Excel, pas juste des valeurs figées.
      rows.forEach((_, i) => {
        const rowNum = i + 2;
        ws[`E${rowNum}`] = { t: 'n', f: `D${rowNum}/1.2` };
        ws[`F${rowNum}`] = { t: 'n', f: `D${rowNum}-E${rowNum}` };
      });
      ws['!cols'] = [{ wch: 12 }, { wch: 26 }, { wch: 28 }, { wch: 16 }, { wch: 14 }, { wch: 14 }];

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Ventes');
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
