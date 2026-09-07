import { useState } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from '../lib/supabase';
import { BankTransaction } from './useBankTransactions';

export interface LedgerExportResult {
  success: boolean;
  rowsCount?: number;
  error?: string;
}

/**
 * Export comptable (.xlsx) du journal de banque, pour l'expert-comptable —
 * une ligne par transaction Qonto (compte 512000 "Banque"), Débit/Crédit
 * selon le sens. Volontairement PAS un export FEC en partie double complet :
 * ça exigerait un vrai plan comptable par catégorie de dépense/recette que
 * ce repo n'a pas (voir useExpenses.ts, catégories libres non mappées à des
 * comptes PCG) — mieux vaut un journal de banque simple et honnête qu'une
 * contrepartie comptable inventée. Même pattern XLSX que
 * useSalesJournalExport.ts (SheetJS, aoa_to_sheet + writeFile).
 */
export const useAccountingLedgerExport = () => {
  const [exporting, setExporting] = useState(false);

  const exportLedger = async (startDate: string, endDate: string): Promise<LedgerExportResult> => {
    setExporting(true);
    try {
      if (!startDate) throw new Error('La date de début est requise');
      const effectiveEndDate = endDate || new Date().toISOString().slice(0, 10);
      const startIso = new Date(`${startDate}T00:00:00`).toISOString();
      const endIso = new Date(`${effectiveEndDate}T23:59:59.999`).toISOString();

      const { data, error } = await supabase
        .from('bank_transactions')
        .select('*')
        .gte('settled_at', startIso)
        .lte('settled_at', endIso)
        .order('settled_at', { ascending: true });
      if (error) throw new Error(error.message);

      const rows = (data || []) as BankTransaction[];
      if (rows.length === 0) {
        return { success: false, error: 'Aucune transaction bancaire trouvée sur cette période.' };
      }

      const dateStr = (iso: string | null) =>
        iso ? new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';

      const header = ['Date', 'Journal', 'Compte', 'Débit', 'Crédit', 'Libellé'];
      const aoa: (string | number)[][] = [
        header,
        ...rows.map((t) => [
          dateStr(t.settled_at),
          'BQ',
          '512000',
          t.side === 'debit' ? Number(t.amount) : 0,
          t.side === 'credit' ? Number(t.amount) : 0,
          t.label || t.counterparty_name || t.qonto_transaction_id,
        ]),
      ];

      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws['!cols'] = [{ wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 40 }];

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Journal de banque');
      XLSX.writeFile(wb, `journal_banque_du_${startDate}_au_${effectiveEndDate}.xlsx`);

      return { success: true, rowsCount: rows.length };
    } catch (err) {
      console.error('Erreur export journal de banque:', err);
      return { success: false, error: err instanceof Error ? err.message : 'Erreur inconnue' };
    } finally {
      setExporting(false);
    }
  };

  return { exporting, exportLedger };
};
