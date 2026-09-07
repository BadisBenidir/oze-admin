import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export type ReconciliationStatus = 'unmatched' | 'matched' | 'ignored';
export type MatchedType = 'order' | 'sourcing_mission' | 'expense' | 'stripe_payout' | 'other' | null;

export interface BankTransaction {
  id: string;
  qonto_transaction_id: string;
  qonto_status: string | null;
  side: 'debit' | 'credit';
  operation_type: string | null;
  amount: number;
  currency: string;
  label: string | null;
  counterparty_name: string | null;
  emitted_at: string | null;
  settled_at: string | null;
  attachment_ids: string[];
  reconciliation_status: ReconciliationStatus;
  matched_type: MatchedType;
  matched_order_id: string | null;
  matched_sourcing_mission_id: string | null;
  matched_expense_id: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface BankAccountSnapshot {
  balance: number;
  currency: string;
  iban: string | null;
  fetched_at: string;
}

interface SyncResult {
  success: boolean;
  error?: string;
  transactionsSynced?: number;
  autoMatched?: number;
}

/**
 * Trésorerie Qonto — lit exclusivement le cache local (bank_transactions /
 * bank_account_snapshot, 0114_qonto_bank_transactions.sql), jamais l'API
 * Qonto en direct depuis le navigateur (la clé secrète ne quitte jamais le
 * serveur, voir qonto-sync). `syncNow` déclenche cette synchro à la demande
 * plutôt que d'attendre le prochain passage du job pg_cron (toutes les 3h).
 */
export const useBankTransactions = (isAdmin: boolean, monthFilter?: string) => {
  const [transactions, setTransactions] = useState<BankTransaction[]>([]);
  const [snapshot, setSnapshot] = useState<BankAccountSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const fetchData = useCallback(async () => {
    if (!isAdmin) {
      setTransactions([]);
      setSnapshot(null);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);

      let query = supabase.from('bank_transactions').select('*').order('settled_at', { ascending: false }).limit(500);
      if (monthFilter) {
        const start = `${monthFilter}-01`;
        const startDate = new Date(`${start}T00:00:00`);
        const end = new Date(startDate);
        end.setMonth(end.getMonth() + 1);
        query = query.gte('settled_at', startDate.toISOString()).lt('settled_at', end.toISOString());
      }

      const [txResult, snapshotResult] = await Promise.all([
        query,
        supabase.from('bank_account_snapshot').select('balance, currency, iban, fetched_at').eq('id', 'main').maybeSingle(),
      ]);

      if (txResult.error) throw new Error(txResult.error.message);
      if (snapshotResult.error) throw new Error(snapshotResult.error.message);

      setTransactions((txResult.data || []) as BankTransaction[]);
      setSnapshot(snapshotResult.data as BankAccountSnapshot | null);
    } catch (err) {
      console.error('Erreur lors du chargement des transactions bancaires:', err);
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  }, [isAdmin, monthFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const syncNow = async (): Promise<SyncResult> => {
    setSyncing(true);
    const { data, error: invokeError } = await supabase.functions.invoke('qonto-sync', { body: {} });
    setSyncing(false);
    if (invokeError) return { success: false, error: invokeError.message };
    if (data?.error) return { success: false, error: data.error };
    await fetchData();
    return { success: true, transactionsSynced: data?.transactions_synced, autoMatched: data?.auto_matched };
  };

  const setReconciliation = async (
    id: string,
    updates: {
      reconciliation_status: ReconciliationStatus;
      matched_type: MatchedType;
      matched_order_id?: string | null;
      matched_sourcing_mission_id?: string | null;
      matched_expense_id?: string | null;
      note?: string | null;
    }
  ): Promise<{ success: boolean; error?: string }> => {
    const { error: updateError } = await supabase
      .from('bank_transactions')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (updateError) return { success: false, error: updateError.message };
    await fetchData();
    return { success: true };
  };

  const uploadAttachment = async (bankTransactionId: string, file: File): Promise<{ success: boolean; error?: string }> => {
    const formData = new FormData();
    formData.append('bank_transaction_id', bankTransactionId);
    formData.append('file', file);
    const { data, error: invokeError } = await supabase.functions.invoke('qonto-attachment-upload', { body: formData });
    if (invokeError) return { success: false, error: invokeError.message };
    if (data?.error) return { success: false, error: data.error };
    await fetchData();
    return { success: true };
  };

  const missingReceiptsCount = transactions.filter(
    (t) => t.side === 'debit' && t.attachment_ids.length === 0 && t.reconciliation_status !== 'ignored'
  ).length;

  return {
    transactions,
    snapshot,
    loading,
    error,
    syncing,
    syncNow,
    setReconciliation,
    uploadAttachment,
    missingReceiptsCount,
    refresh: fetchData,
  };
};
