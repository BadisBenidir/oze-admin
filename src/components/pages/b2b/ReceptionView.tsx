import React, { useState } from 'react';
import { Card, CardContent } from '../../ui/Card';
import { useAdminAuth } from '../../../hooks/useAdminAuth';
import { useReceptionItems, ReceptionItem } from '../../../hooks/useReceptionItems';
import { AlertCircle, ImageOff, PackageCheck, PackagePlus } from 'lucide-react';

interface ItemRowProps {
  item: ReceptionItem;
  checked: boolean;
  onToggle: (id: string) => void;
}

const ItemRow: React.FC<ItemRowProps> = ({ item, checked, onToggle }) => {
  const image = item.product_snapshot?.images?.[item.product_snapshot?.main_image_index ?? 0] || item.product_snapshot?.images?.[0];
  return (
    <label className="flex items-center gap-3 px-4 py-2.5 border-b border-gray-50 last:border-b-0 cursor-pointer hover:bg-gray-50">
      <input
        type="checkbox"
        checked={checked}
        onChange={() => onToggle(item.id)}
        className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-400 flex-shrink-0"
      />
      <div className="h-9 w-9 bg-gray-100 rounded flex items-center justify-center overflow-hidden flex-shrink-0">
        {image ? <img src={image} alt={item.product_snapshot?.name} className="h-full w-full object-cover" /> : <ImageOff className="h-4 w-4 text-gray-300" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-gray-900 truncate">{item.product_snapshot?.name || 'Article'}</p>
        <p className="text-xs text-gray-400 font-mono">{item.order?.order_number}</p>
      </div>
    </label>
  );
};

export const ReceptionView: React.FC = () => {
  const { isAdmin } = useAdminAuth();
  const { groups, loading, error, markReceived, markReadyToShip } = useReceptionItems(isAdmin);
  const [selection, setSelection] = useState<Record<string, Set<string>>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const selectedFor = (groupKey: string) => selection[groupKey] || new Set<string>();

  const toggle = (groupKey: string, itemId: string) => {
    setSelection((prev) => {
      const next = new Set(prev[groupKey] || []);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return { ...prev, [groupKey]: next };
    });
  };

  const clearSelection = (groupKey: string) => {
    setSelection((prev) => ({ ...prev, [groupKey]: new Set() }));
  };

  const handleMarkReceived = async (groupKey: string) => {
    const ids = Array.from(selectedFor(groupKey));
    if (ids.length === 0) return;
    setBusyKey(groupKey);
    await markReceived(ids);
    clearSelection(groupKey);
    setBusyKey(null);
  };

  const handleMarkReadyToShip = async (groupKey: string) => {
    const ids = Array.from(selectedFor(groupKey));
    if (ids.length === 0) return;
    setBusyKey(groupKey);
    await markReadyToShip(ids);
    clearSelection(groupKey);
    setBusyKey(null);
  };

  return (
    <div className="p-4 md:p-6">
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-gray-900">Vue Réception</h3>
        <p className="text-sm text-gray-500">Réceptionnez les articles B2B puis marquez-les prêts à être livrés aux revendeurs.</p>
      </div>

      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 flex items-center space-x-3">
          <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0" />
          <p className="text-sm text-red-700">Erreur : {error}</p>
        </div>
      )}

      {loading && (
        <div className="space-y-4">
          {[...Array(2)].map((_, i) => <div key={i} className="h-32 bg-gray-100 rounded-lg animate-pulse" />)}
        </div>
      )}

      {!loading && !error && groups.length === 0 && (
        <div className="text-center py-16 border border-dashed border-gray-200 rounded-lg">
          <PackageCheck className="h-10 w-10 text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-500">Aucun article en attente de réception ou de mise à disposition.</p>
        </div>
      )}

      {!loading && groups.map((group) => {
        const toReceiveKey = `${group.resellerId}:toReceive`;
        const receivedKey = `${group.resellerId}:received`;
        return (
          <div key={group.resellerId} className="mb-8">
            <h4 className="text-sm font-semibold text-gray-900 mb-3">{group.companyName}</h4>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">À réceptionner ({group.toReceive.length})</p>
                  <button
                    onClick={() => handleMarkReceived(toReceiveKey)}
                    disabled={selectedFor(toReceiveKey).size === 0 || busyKey === toReceiveKey}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-900 text-white text-xs font-medium rounded-lg hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    <PackagePlus className="h-3.5 w-3.5" />
                    Marquer comme reçu
                  </button>
                </div>
                <Card>
                  <CardContent className="p-0">
                    {group.toReceive.length === 0 ? (
                      <p className="text-xs text-gray-400 px-4 py-6 text-center">Rien à réceptionner.</p>
                    ) : (
                      group.toReceive.map((item) => (
                        <ItemRow key={item.id} item={item} checked={selectedFor(toReceiveKey).has(item.id)} onToggle={(id) => toggle(toReceiveKey, id)} />
                      ))
                    )}
                  </CardContent>
                </Card>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Reçus ({group.received.length})</p>
                  <button
                    onClick={() => handleMarkReadyToShip(receivedKey)}
                    disabled={selectedFor(receivedKey).size === 0 || busyKey === receivedKey}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-900 text-white text-xs font-medium rounded-lg hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    <PackageCheck className="h-3.5 w-3.5" />
                    Marquer prêt à être livré
                  </button>
                </div>
                <Card>
                  <CardContent className="p-0">
                    {group.received.length === 0 ? (
                      <p className="text-xs text-gray-400 px-4 py-6 text-center">Rien de reçu en attente.</p>
                    ) : (
                      group.received.map((item) => (
                        <ItemRow key={item.id} item={item} checked={selectedFor(receivedKey).has(item.id)} onToggle={(id) => toggle(receivedKey, id)} />
                      ))
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default ReceptionView;
