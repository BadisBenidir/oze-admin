import React, { useState } from 'react';
import { Ban, RotateCcw } from 'lucide-react';
import { Modal } from '../../ui/Modal';
import { supabase } from '../../../lib/supabase';
import { invokeEdgeFunction } from '../../../utils/invokeEdgeFunction';

interface Preview {
  club: boolean;
  subscription_status: string;
  amount_paid: number;
  period_start: string | null;
  period_end: string | null;
  days_used: number | null;
  days_total: number | null;
  refund: number;
  success?: boolean;
  refund_error?: string | null;
}

const eur = (n: number) => n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('fr-FR') : '—');

/**
 * Résiliation immédiate d'un abonnement (abonné Club ou membre de communauté,
 * 0237, admin-cancel-subscription) : aperçu du remboursement au prorata puis
 * confirmation. Accès retiré : « Rétablir l'accès ».
 */
export const RevokeSubscriptionControl: React.FC<{
  contactId: string;
  name: string;
  revokedAt: string | null;
  onChanged: () => void;
  compact?: boolean;
}> = ({ contactId, name, revokedAt, onChanged, compact }) => {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setOpen(true);
    setPreview(null);
    setError(null);
    setLoading(true);
    const { data, error: e } = await invokeEdgeFunction<Preview>('admin-cancel-subscription', { contactId, action: 'preview' });
    setLoading(false);
    if (e || !data) return setError(e || 'Lecture de l\'abonnement impossible');
    setPreview(data);
  };

  const confirm = async () => {
    setLoading(true);
    setError(null);
    const { data, error: e } = await invokeEdgeFunction<Preview>('admin-cancel-subscription', { contactId, action: 'confirm' });
    setLoading(false);
    if (e || !data?.success) return setError(e || 'Résiliation impossible');
    setOpen(false);
    alert(
      data.refund_error
        ? `Abonnement résilié et accès retiré, mais le remboursement a échoué : ${data.refund_error}`
        : `Abonnement résilié et accès retiré.${data.refund ? ` ${eur(data.refund)} remboursés sur sa carte.` : ' Aucun remboursement.'}`
    );
    onChanged();
  };

  const restore = async () => {
    if (!window.confirm(`Rendre l'accès à ${name} ? ${'\n'}Il devra se réabonner pour acheter à nouveau.`)) return;
    const { error: e } = await supabase.rpc('admin_restore_access', { p_contact_id: contactId });
    if (e) return alert(e.message);
    onChanged();
  };

  if (revokedAt) {
    return (
      <span className="inline-flex items-center gap-2">
        <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">Accès retiré le {day(revokedAt)}</span>
        <button type="button" onClick={restore} title="Rétablir l'accès" className="inline-flex items-center gap-1 text-xs font-medium text-gray-600 underline hover:text-gray-900">
          <RotateCcw className="h-3.5 w-3.5" /> Rétablir
        </button>
      </span>
    );
  }

  return (
    <>
      {compact ? (
        <button
          type="button"
          onClick={start}
          className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
          title="Résilier son abonnement immédiatement (remboursé au prorata)"
        >
          <Ban className="h-4 w-4" />
        </button>
      ) : (
        <button
          type="button"
          onClick={start}
          className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
        >
          <Ban className="h-3.5 w-3.5" /> Résilier immédiatement
        </button>
      )}

      <Modal isOpen={open} onClose={() => !loading && setOpen(false)} title={`Résilier l'abonnement de ${name}`}>
        <div className="space-y-4 text-sm">
          {loading && !preview && <p className="text-gray-500">Lecture de l'abonnement chez Stripe…</p>}
          {preview && (
            <>
              <div className="rounded-lg bg-gray-50 p-3 space-y-1">
                <p>Dernier paiement : <strong>{eur(preview.amount_paid)}</strong> pour la période du {day(preview.period_start)} au {day(preview.period_end)}</p>
                {preview.days_total ? <p>Utilisé : {preview.days_used} jour{(preview.days_used || 0) > 1 ? 's' : ''} sur {preview.days_total}</p> : null}
                <p className="text-base">Remboursement : <strong>{eur(preview.refund)}</strong> sur sa carte</p>
              </div>
              <ul className="list-disc space-y-1 pl-5 text-gray-600">
                <li>L'abonnement Stripe est arrêté tout de suite, plus aucun prélèvement.</li>
                <li>Il n'a plus accès au catalogue, aux drops, aux enchères ni au sourcing.</li>
                <li>Il garde son espace pour voir ses commandes, ses factures et son portefeuille.</li>
                <li>Le remboursement est déduit du CA des abonnements.</li>
              </ul>
            </>
          )}
          {error && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-700">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} disabled={loading} className="rounded-lg px-3 py-2 text-gray-600 hover:bg-gray-100">
              Annuler
            </button>
            <button
              type="button"
              onClick={confirm}
              disabled={loading || !preview}
              className="rounded-lg bg-red-600 px-4 py-2 font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              {loading && preview ? 'Résiliation…' : `Résilier${preview?.refund ? ` et rembourser ${eur(preview.refund)}` : ''}`}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
};
