import React, { useEffect, useState } from 'react';
import { Modal } from '../../ui/Modal';
import { Clock, ShieldAlert } from 'lucide-react';
import { CartBlockingError } from '../../../hooks/useB2BCart';

interface CartBlockingModalProps {
  blockingError: CartBlockingError | null;
  onClose: () => void;
}

const formatCountdown = (ms: number): string => {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

/**
 * Alerte bloquante pour les refus temporisés de cart_add_item (cooldown de
 * quota pendant le drop, verrou anti-reset de 3 min) : affiche le message
 * serveur et un compte à rebours MM:SS jusqu'à la prochaine tentative
 * possible. Se ferme d'elle-même (côté hook) dès que le délai est écoulé.
 */
export const CartBlockingModal: React.FC<CartBlockingModalProps> = ({ blockingError, onClose }) => {
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!blockingError?.retryAt) return;
    const interval = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, [blockingError?.retryAt]);

  if (!blockingError) return null;

  const remainingMs = blockingError.retryAt !== null ? blockingError.retryAt - Date.now() : null;

  return (
    <Modal isOpen={Boolean(blockingError)} onClose={onClose} title="">
      <div className="text-center py-4">
        <div className="mx-auto flex items-center justify-center w-12 h-12 bg-amber-100 rounded-full mb-4">
          <ShieldAlert className="w-6 h-6 text-amber-600" />
        </div>

        <h3 className="text-lg font-medium text-gray-900 mb-2">Veuillez patienter</h3>

        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
          <p className="text-sm text-amber-800">{blockingError.message}</p>
        </div>

        {remainingMs !== null && remainingMs > 0 && (
          <div className="flex items-center justify-center gap-2 mb-6 text-2xl font-semibold text-gray-900 tabular-nums">
            <Clock className="h-5 w-5 text-gray-400" />
            {formatCountdown(remainingMs)}
          </div>
        )}

        <button
          onClick={onClose}
          className="w-full px-4 py-2 bg-gray-900 text-white font-medium rounded-md hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 transition-colors"
        >
          Compris
        </button>
      </div>
    </Modal>
  );
};
