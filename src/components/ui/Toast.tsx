import React, { useEffect, useState } from 'react';
import { CheckCircle, X } from 'lucide-react';

interface ToastProps {
  message: string;
  onDismiss: () => void;
  duration?: number;
}

/**
 * Notification éphémère flottante (succès), pas un bandeau inline : se
 * ferme automatiquement après `duration` ms, ou manuellement via la croix.
 */
export const Toast: React.FC<ToastProps> = ({ message, onDismiss, duration = 4000 }) => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Monté à opacité 0 puis basculé au tick suivant : déclenche la
    // transition CSS d'entrée sans dépendre d'un plugin d'animation.
    const enter = requestAnimationFrame(() => setVisible(true));
    const timer = setTimeout(onDismiss, duration);
    return () => {
      cancelAnimationFrame(enter);
      clearTimeout(timer);
    };
  }, [onDismiss, duration]);

  return (
    <div
      className={`fixed top-4 right-4 z-50 transition-all duration-300 ease-out ${
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2'
      }`}
    >
      <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-lg shadow-lg px-4 py-3 max-w-sm">
        <CheckCircle className="h-5 w-5 text-green-600 flex-shrink-0" />
        <p className="text-sm font-medium text-green-800">{message}</p>
        <button onClick={onDismiss} className="ml-2 text-green-500 hover:text-green-700 flex-shrink-0">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};
