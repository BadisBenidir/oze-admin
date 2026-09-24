import React from 'react';
import { Info, CheckCircle2 } from 'lucide-react';
import { ResellerNotification } from '../../../hooks/useResellerNotifications';

interface ResellerNotificationsBannerProps {
  notifications: ResellerNotification[];
  onDismiss: (id: string) => void;
}

/** Bandeaux persistants en haut de l'espace pro : restent affichés sur
 * toutes les pages tant que le revendeur n'a pas cliqué "J'ai compris". */
export const ResellerNotificationsBanner: React.FC<ResellerNotificationsBannerProps> = ({ notifications, onDismiss }) => {
  if (notifications.length === 0) return null;

  return (
    <div className="m-4 md:m-6 space-y-3">
      {notifications.map((n) => {
        const positive = n.type === 'redelivery_ready';
        const items = n.payload?.items || [];
        return (
          <div
            key={n.id}
            className={`rounded-lg border p-4 ${positive ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'}`}
          >
            <div className="flex items-start gap-3">
              {positive ? (
                <CheckCircle2 className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" />
              ) : (
                <Info className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
              )}
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-semibold ${positive ? 'text-green-900' : 'text-amber-900'}`}>{n.title}</p>
                <p className={`text-sm mt-1 whitespace-pre-line ${positive ? 'text-green-800' : 'text-amber-800'}`}>{n.message}</p>
                {items.length > 0 && (
                  <ul className="mt-2 space-y-0.5">
                    {items.map((item, i) => (
                      <li key={i} className={`text-sm ${positive ? 'text-green-900' : 'text-amber-900'}`}>
                        <span className="font-mono font-medium">{item.reference}</span>
                        {item.name && <span className="opacity-75"> — {item.name}</span>}
                      </li>
                    ))}
                  </ul>
                )}
                <button
                  onClick={() => onDismiss(n.id)}
                  className={`mt-3 px-3 py-1.5 rounded-lg text-sm font-medium text-white transition-colors ${positive ? 'bg-green-700 hover:bg-green-800' : 'bg-gray-900 hover:bg-gray-800'}`}
                >
                  J'ai compris
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default ResellerNotificationsBanner;
