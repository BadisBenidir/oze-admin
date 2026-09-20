import React, { useState } from 'react';
import { Card, CardContent } from '../../ui/Card';
import { useAdminAuth } from '../../../hooks/useAdminAuth';
import { useReceptionItems, ReceptionItem } from '../../../hooks/useReceptionItems';
import { AlertCircle, ImageOff, PackageCheck, PackagePlus, Undo2 } from 'lucide-react';

interface ItemRowProps {
  item: ReceptionItem;
  checked: boolean;
  onToggle: (id: string) => void;
  onRevertOne?: (id: string) => void;
  revertBusy?: boolean;
}

const ItemRow: React.FC<ItemRowProps> = ({ item, checked, onToggle, onRevertOne, revertBusy }) => {
  const image = item.product_snapshot?.images?.[item.product_snapshot?.main_image_index ?? 0] || item.product_snapshot?.images?.[0];
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-gray-50 last:border-b-0 hover:bg-gray-50">
      <label className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer">
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
      {onRevertOne && (
        <button
          type="button"
          onClick={() => onRevertOne(item.id)}
          disabled={revertBusy}
          title="Remettre en attente"
          className="p-1.5 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
        >
          <Undo2 className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
};

// Regroupe par jour de création (created_at, déjà trié ascendant par la
// requête — voir useReceptionItems.ts) plutôt que de laisser l'ordre
// implicite : l'admin doit pouvoir voir directement quels articles sont
// arrivés le même jour, pas juste deviner un tri invisible.
const dateKey = (iso: string) => iso.slice(0, 10);
const formatDateHeader = (key: string) =>
  new Date(`${key}T00:00:00`).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });

interface DateGroupedListProps {
  items: ReceptionItem[];
  emptyLabel: string;
  checkedIds: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: (ids: string[]) => void;
  onRevertOne?: (id: string) => void;
  revertBusy?: boolean;
}

const DateGroupedList: React.FC<DateGroupedListProps> = ({ items, emptyLabel, checkedIds, onToggle, onToggleAll, onRevertOne, revertBusy }) => {
  if (items.length === 0) {
    return <p className="text-xs text-gray-400 px-4 py-6 text-center">{emptyLabel}</p>;
  }

  const groups = new Map<string, ReceptionItem[]>();
  items.forEach((item) => {
    const key = dateKey(item.created_at);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
  });

  return (
    <>
      {Array.from(groups.entries()).map(([date, dateItems]) => {
        const ids = dateItems.map((i) => i.id);
        const allChecked = ids.every((id) => checkedIds.has(id));
        return (
          <div key={date}>
            <div className="flex items-center justify-between px-4 py-1.5 bg-gray-50 border-b border-gray-100">
              <p className="text-[11px] font-medium text-gray-500">{formatDateHeader(date)}</p>
              <button
                type="button"
                onClick={() => onToggleAll(ids)}
                className="text-[11px] font-medium text-gray-600 hover:text-gray-900 underline flex-shrink-0"
              >
                {allChecked ? 'Tout désélectionner' : 'Tout sélectionner'}
              </button>
            </div>
            {dateItems.map((item) => (
              <ItemRow key={item.id} item={item} checked={checkedIds.has(item.id)} onToggle={onToggle} onRevertOne={onRevertOne} revertBusy={revertBusy} />
            ))}
          </div>
        );
      })}
    </>
  );
};

export const ReceptionView: React.FC = () => {
  const { isAdmin } = useAdminAuth();
  const { groups, loading, error, markReceived, markReadyToShip, revertToReceived } = useReceptionItems(isAdmin);
  const [selection, setSelection] = useState<Record<string, Set<string>>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

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

  // Sélectionne/désélectionne tout un lot d'ids d'un coup — utilisé par le
  // bouton "Tout sélectionner" en tête de colonne (toutes dates confondues)
  // et par celui de chaque en-tête de date (0150).
  const toggleAll = (groupKey: string, ids: string[]) => {
    setSelection((prev) => {
      const current = prev[groupKey] || new Set<string>();
      const allSelected = ids.length > 0 && ids.every((id) => current.has(id));
      const next = new Set(current);
      if (allSelected) ids.forEach((id) => next.delete(id));
      else ids.forEach((id) => next.add(id));
      return { ...prev, [groupKey]: next };
    });
  };

  const handleMarkReceived = async (groupKey: string) => {
    const ids = Array.from(selectedFor(groupKey));
    if (ids.length === 0) return;
    setActionError(null);
    setBusyKey(groupKey);
    const result = await markReceived(ids);
    setBusyKey(null);
    if (!result.success) {
      setActionError(result.error || "Impossible de marquer ces articles comme reçus");
      return;
    }
    clearSelection(groupKey);
  };

  const handleMarkReadyToShip = async (groupKey: string) => {
    const ids = Array.from(selectedFor(groupKey));
    if (ids.length === 0) return;
    setActionError(null);
    setBusyKey(groupKey);
    const result = await markReadyToShip(ids);
    setBusyKey(null);
    if (!result.success) {
      setActionError(result.error || "Impossible de marquer ces articles comme prêts à être livrés");
      return;
    }
    clearSelection(groupKey);
  };

  const handleRevert = async (groupKey: string, ids: string[]) => {
    if (ids.length === 0) return;
    setActionError(null);
    setBusyKey(groupKey);
    const result = await revertToReceived(ids);
    setBusyKey(null);
    if (!result.success) {
      setActionError(result.error || "Impossible de remettre ces articles en attente");
      return;
    }
    clearSelection(groupKey);
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

      {actionError && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0" />
            <p className="text-sm text-red-700">{actionError}</p>
          </div>
          <button onClick={() => setActionError(null)} className="text-red-600 hover:text-red-800 text-sm flex-shrink-0">✕</button>
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
        const readyToShipKey = `${group.resellerId}:readyToShip`;
        const inDeliveryRequestKey = `${group.resellerId}:inDeliveryRequest`;
        return (
          <div key={group.resellerId} className="mb-8">
            <h4 className="text-sm font-semibold text-gray-900 mb-3">{group.companyName}</h4>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
              <div>
                <div className="flex items-center justify-between mb-2 gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide whitespace-nowrap">À réceptionner ({group.toReceive.length})</p>
                    {group.toReceive.length > 0 && (
                      <button
                        type="button"
                        onClick={() => toggleAll(toReceiveKey, group.toReceive.map((i) => i.id))}
                        className="text-[11px] font-medium text-gray-500 hover:text-gray-900 underline flex-shrink-0"
                      >
                        Tout sélectionner
                      </button>
                    )}
                  </div>
                  <button
                    onClick={() => handleMarkReceived(toReceiveKey)}
                    disabled={selectedFor(toReceiveKey).size === 0 || busyKey === toReceiveKey}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-900 text-white text-xs font-medium rounded-lg hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0"
                  >
                    <PackagePlus className="h-3.5 w-3.5" />
                    Marquer comme reçu
                  </button>
                </div>
                <Card>
                  <CardContent className="p-0">
                    <DateGroupedList
                      items={group.toReceive}
                      emptyLabel="Rien à réceptionner."
                      checkedIds={selectedFor(toReceiveKey)}
                      onToggle={(id) => toggle(toReceiveKey, id)}
                      onToggleAll={(ids) => toggleAll(toReceiveKey, ids)}
                    />
                  </CardContent>
                </Card>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2 gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide whitespace-nowrap">Reçus ({group.received.length})</p>
                    {group.received.length > 0 && (
                      <button
                        type="button"
                        onClick={() => toggleAll(receivedKey, group.received.map((i) => i.id))}
                        className="text-[11px] font-medium text-gray-500 hover:text-gray-900 underline flex-shrink-0"
                      >
                        Tout sélectionner
                      </button>
                    )}
                  </div>
                  <button
                    onClick={() => handleMarkReadyToShip(receivedKey)}
                    disabled={selectedFor(receivedKey).size === 0 || busyKey === receivedKey}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-900 text-white text-xs font-medium rounded-lg hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0"
                  >
                    <PackageCheck className="h-3.5 w-3.5" />
                    Marquer prêt à être livré
                  </button>
                </div>
                <Card>
                  <CardContent className="p-0">
                    <DateGroupedList
                      items={group.received}
                      emptyLabel="Rien de reçu en attente."
                      checkedIds={selectedFor(receivedKey)}
                      onToggle={(id) => toggle(receivedKey, id)}
                      onToggleAll={(ids) => toggleAll(receivedKey, ids)}
                    />
                  </CardContent>
                </Card>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2 gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide whitespace-nowrap">Prêts à être livrés ({group.readyToShip.length})</p>
                    {group.readyToShip.length > 0 && (
                      <button
                        type="button"
                        onClick={() => toggleAll(readyToShipKey, group.readyToShip.map((i) => i.id))}
                        className="text-[11px] font-medium text-gray-500 hover:text-gray-900 underline flex-shrink-0"
                      >
                        Tout sélectionner
                      </button>
                    )}
                  </div>
                  <button
                    onClick={() => handleRevert(readyToShipKey, Array.from(selectedFor(readyToShipKey)))}
                    disabled={selectedFor(readyToShipKey).size === 0 || busyKey === readyToShipKey}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-white text-gray-700 border border-gray-300 text-xs font-medium rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0"
                  >
                    <Undo2 className="h-3.5 w-3.5" />
                    Remettre en attente
                  </button>
                </div>
                <Card>
                  <CardContent className="p-0">
                    <DateGroupedList
                      items={group.readyToShip}
                      emptyLabel="Rien de prêt à être livré."
                      checkedIds={selectedFor(readyToShipKey)}
                      onToggle={(id) => toggle(readyToShipKey, id)}
                      onToggleAll={(ids) => toggleAll(readyToShipKey, ids)}
                      onRevertOne={(id) => handleRevert(readyToShipKey, [id])}
                      revertBusy={busyKey === readyToShipKey}
                    />
                  </CardContent>
                </Card>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2 gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide whitespace-nowrap">Demande en cours ({group.inDeliveryRequest.length})</p>
                    {group.inDeliveryRequest.length > 0 && (
                      <button
                        type="button"
                        onClick={() => toggleAll(inDeliveryRequestKey, group.inDeliveryRequest.map((i) => i.id))}
                        className="text-[11px] font-medium text-gray-500 hover:text-gray-900 underline flex-shrink-0"
                      >
                        Tout sélectionner
                      </button>
                    )}
                  </div>
                  <button
                    onClick={() => handleRevert(inDeliveryRequestKey, Array.from(selectedFor(inDeliveryRequestKey)))}
                    disabled={selectedFor(inDeliveryRequestKey).size === 0 || busyKey === inDeliveryRequestKey}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-white text-gray-700 border border-gray-300 text-xs font-medium rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0"
                  >
                    <Undo2 className="h-3.5 w-3.5" />
                    Annuler / remettre en attente
                  </button>
                </div>
                <Card>
                  <CardContent className="p-0">
                    <DateGroupedList
                      items={group.inDeliveryRequest}
                      emptyLabel="Aucune demande de livraison en cours."
                      checkedIds={selectedFor(inDeliveryRequestKey)}
                      onToggle={(id) => toggle(inDeliveryRequestKey, id)}
                      onToggleAll={(ids) => toggleAll(inDeliveryRequestKey, ids)}
                      onRevertOne={(id) => handleRevert(inDeliveryRequestKey, [id])}
                      revertBusy={busyKey === inDeliveryRequestKey}
                    />
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
