import React, { useEffect, useState } from 'react';
import { X, XCircle, Loader2 } from 'lucide-react';

/** Motifs prédéfinis : le texte est inséré dans l'email d'annulation envoyé au
 * client (Edge Function cancel-order, paramètre customer_message) et reste
 * modifiable avant l'envoi. */
const PRESETS: { id: string; label: string; message: string }[] = [
  {
    id: 'none',
    label: 'Sans message particulier',
    message: '',
  },
  {
    id: 'already_sold',
    label: 'Article déjà vendu (bug d\'affichage)',
    message:
      "Suite à un problème technique d'affichage sur notre site, l'article que vous avez commandé apparaissait encore comme disponible alors qu'il avait déjà été vendu. Nous en sommes sincèrement désolés.",
  },
  {
    id: 'defect',
    label: 'Défaut constaté lors du contrôle',
    message:
      "Lors du contrôle qualité effectué avant l'expédition, nous avons constaté sur l'article un défaut qui ne correspond pas à nos exigences ni à la description de l'annonce. Nous préférons donc annuler votre commande plutôt que de vous envoyer une pièce non conforme.",
  },
  {
    id: 'unavailable',
    label: 'Article indisponible',
    message: "L'article que vous avez commandé n'est malheureusement plus disponible.",
  },
  {
    id: 'custom',
    label: 'Message personnalisé',
    message: '',
  },
];

interface CancelOrderModalProps {
  orderNumber: string;
  isOpen: boolean;
  submitting: boolean;
  onClose: () => void;
  onConfirm: (customerMessage: string) => void;
}

export const CancelOrderModal: React.FC<CancelOrderModalProps> = ({ orderNumber, isOpen, submitting, onClose, onConfirm }) => {
  const [presetId, setPresetId] = useState('already_sold');
  const [message, setMessage] = useState(PRESETS[1].message);

  useEffect(() => {
    if (!isOpen) return;
    setPresetId('already_sold');
    setMessage(PRESETS[1].message);
  }, [isOpen]);

  if (!isOpen) return null;

  const choosePreset = (id: string) => {
    setPresetId(id);
    setMessage(PRESETS.find((p) => p.id === id)?.message ?? '');
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black bg-opacity-50" onClick={submitting ? undefined : onClose} />
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative w-full max-w-lg rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between border-b border-gray-100 p-5">
            <h3 className="text-base font-semibold text-gray-900">Annuler la commande {orderNumber}</h3>
            <button onClick={onClose} disabled={submitting} className="rounded-lg p-1 text-gray-400 hover:text-gray-600">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="space-y-4 p-5">
            <p className="text-sm text-gray-500">
              Le client est remboursé et reçoit un email d'annulation. Choisis le motif à lui indiquer :
            </p>
            <div className="space-y-2">
              {PRESETS.map((p) => (
                <label
                  key={p.id}
                  className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                    presetId === p.id ? 'border-gray-900 bg-gray-50 text-gray-900' : 'border-gray-200 text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  <input
                    type="radio"
                    name="cancel-preset"
                    checked={presetId === p.id}
                    onChange={() => choosePreset(p.id)}
                    className="accent-gray-900"
                  />
                  {p.label}
                </label>
              ))}
            </div>

            {presetId !== 'none' && (
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Message inséré dans l'email (modifiable)</label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={5}
                  placeholder="Écris le message pour le client…"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none"
                />
              </div>
            )}
          </div>

          <div className="flex justify-end gap-3 p-5 pt-0">
            <button
              onClick={onClose}
              disabled={submitting}
              className="rounded-lg bg-gray-100 px-4 py-2 text-sm text-gray-700 hover:bg-gray-200 disabled:opacity-50"
            >
              Retour
            </button>
            <button
              onClick={() => onConfirm(presetId === 'none' ? '' : message.trim())}
              disabled={submitting || (presetId === 'custom' && !message.trim())}
              className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
              Annuler la commande
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CancelOrderModal;
