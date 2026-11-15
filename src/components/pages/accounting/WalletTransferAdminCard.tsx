import React, { useCallback, useEffect, useState } from 'react';
import { Gift, Loader2, Save } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { Card, CardContent, CardHeader } from '../../ui/Card';

const EUR = (n: number) => (Number(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';

/**
 * Rechargement du portefeuille par virement (0292) : réglages (taux du bonus,
 * minimum) modifiables sans redéploiement, et suivi des bonus — accordés,
 * utilisés en achats (remise déduite du CA), restants dans les soldes.
 * Les virements sans référence s'attribuent depuis « Encaissements sans
 * justificatif » (bouton « Recharge portefeuille »).
 */
export const WalletTransferAdminCard: React.FC = () => {
  const [rate, setRate] = useState('');
  const [min, setMin] = useState('');
  const [iban, setIban] = useState<string | null>(null);
  const [stats, setStats] = useState<{ granted: number; used: number; remaining: number; transfers: number; received: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    const [{ data: s }, { data: tx }, { data: orders }, { data: profiles }] = await Promise.all([
      supabase.from('wallet_settings').select('transfer_bonus_rate, transfer_min_amount, iban').maybeSingle(),
      supabase.from('wallet_transactions').select('paid_amount, bonus_amount').not('bank_transaction_id', 'is', null),
      supabase.from('orders').select('wallet_bonus_used').gt('wallet_bonus_used', 0),
      supabase.from('profiles').select('wallet_bonus_balance').gt('wallet_bonus_balance', 0),
    ]);
    if (s) {
      setRate(String(Math.round(Number(s.transfer_bonus_rate) * 10000) / 100).replace('.', ','));
      setMin(String(s.transfer_min_amount).replace('.', ','));
      setIban(s.iban);
    }
    const sum = (rows: Record<string, unknown>[] | null, k: string) => (rows || []).reduce((t, r) => t + (Number(r[k]) || 0), 0);
    setStats({
      transfers: (tx || []).length,
      received: sum(tx as Record<string, unknown>[] | null, 'paid_amount'),
      granted: sum(tx as Record<string, unknown>[] | null, 'bonus_amount'),
      used: sum(orders as Record<string, unknown>[] | null, 'wallet_bonus_used'),
      remaining: sum(profiles as Record<string, unknown>[] | null, 'wallet_bonus_balance'),
    });
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    const r = Number(rate.replace(',', '.'));
    const m = Number(min.replace(',', '.'));
    if (!Number.isFinite(r) || r < 0 || r >= 100) return setNotice('Taux invalide');
    if (!Number.isFinite(m) || m < 0) return setNotice('Minimum invalide');
    setSaving(true);
    const { error } = await supabase
      .from('wallet_settings')
      .update({ transfer_bonus_rate: r / 100, transfer_min_amount: m, updated_at: new Date().toISOString() })
      .eq('id', true);
    setSaving(false);
    setNotice(error ? error.message : 'Réglages enregistrés : appliqués aux prochains virements.');
  };

  return (
    <Card>
      <CardHeader>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900"><Gift className="h-4 w-4 text-amber-600" /> Rechargements par virement</h3>
        <p className="mt-0.5 text-xs text-gray-500">
          Crédités automatiquement à la synchro Qonto quand le libellé contient la référence du membre (OZE-R-…). Bonus : taux × 100 € par tranche complète de 100 €, à partir du minimum.
          Le bonus n'est pas une charge : utilisé en achat, il est déduit du CA (remise).
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-gray-500">
            Bonus virement (%)
            <input value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" className="mt-1 block h-9 w-28 rounded-lg border border-gray-200 px-2.5 text-sm text-gray-900" />
          </label>
          <label className="text-xs text-gray-500">
            Minimum pour le bonus (€)
            <input value={min} onChange={(e) => setMin(e.target.value)} inputMode="decimal" className="mt-1 block h-9 w-28 rounded-lg border border-gray-200 px-2.5 text-sm text-gray-900" />
          </label>
          <button onClick={save} disabled={saving} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-gray-900 px-3 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Enregistrer
          </button>
          <p className="text-xs text-gray-500">IBAN affiché aux membres : {iban ? `${iban.slice(0, 4)}…${iban.slice(-4)} (Qonto)` : 'renseigné à la prochaine synchro Qonto'}</p>
        </div>
        {notice && <p className="text-xs text-gray-600">{notice}</p>}
        {stats && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: `Reçu par virement (${stats.transfers})`, value: stats.received },
              { label: 'Bonus accordés', value: stats.granted },
              { label: 'Bonus utilisés (remise)', value: stats.used },
              { label: 'Bonus restants', value: stats.remaining },
            ].map((k) => (
              <div key={k.label} className="rounded-lg bg-gray-50 p-3">
                <p className="text-xs text-gray-500">{k.label}</p>
                <p className="text-sm font-semibold tabular-nums text-gray-900">{EUR(k.value)}</p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
