import React, { useState } from 'react';
import { Card, CardContent } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { useAdminAuth } from '../../hooks/useAdminAuth';
import { useDrops, Drop } from '../../hooks/useDrops';
import { CreateDropModal } from './b2b/CreateDropModal';
import { Rocket, Plus, AlertCircle, Package, Pencil, Ban } from 'lucide-react';

const statusBadge = (status: Drop['status']) => {
  switch (status) {
    case 'publie':
      return <Badge variant="success">Publié</Badge>;
    case 'annule':
      return <Badge variant="danger">Annulé</Badge>;
    default:
      return <Badge variant="info">Planifié</Badge>;
  }
};

const formatDateTime = (iso: string): string =>
  new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export const B2BDrops: React.FC = () => {
  const { isAdmin } = useAdminAuth();
  const { drops, loading, error, createDrop, updateDrop, cancelDrop } = useDrops(isAdmin);

  const [showModal, setShowModal] = useState(false);
  const [editingDrop, setEditingDrop] = useState<Drop | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const handleCreate = () => {
    setEditingDrop(null);
    setShowModal(true);
  };

  const handleEdit = (drop: Drop) => {
    setEditingDrop(drop);
    setShowModal(true);
  };

  const handleCancel = async (drop: Drop) => {
    if (!window.confirm(`Annuler le drop "${drop.title || formatDateTime(drop.scheduled_at)}" ? Les articles resteront en brouillon.`)) {
      return;
    }
    setCancellingId(drop.id);
    await cancelDrop(drop.id);
    setCancellingId(null);
  };

  const upcoming = drops.filter((d) => d.status === 'planifie');
  const history = drops.filter((d) => d.status !== 'planifie');

  return (
    <div className="p-4 md:p-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 gap-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Drops B2B</h3>
          <p className="text-sm text-gray-500">Planifie la mise en ligne automatique d'un lot d'articles auprès des revendeurs</p>
        </div>
        <button
          onClick={handleCreate}
          className="flex items-center space-x-2 px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors self-start md:self-auto"
        >
          <Plus className="h-4 w-4" />
          <span>Créer un Drop</span>
        </button>
      </div>

      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 flex items-center space-x-3">
          <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0" />
          <p className="text-sm text-red-700">Erreur : {error}</p>
        </div>
      )}

      <div className="mb-8">
        <h4 className="text-sm font-medium text-gray-700 mb-3">Drops programmés</h4>

        {!loading && upcoming.length === 0 && (
          <div className="text-center py-12 border border-dashed border-gray-200 rounded-lg">
            <Rocket className="h-10 w-10 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-500">Aucun drop programmé pour l'instant.</p>
          </div>
        )}

        {(upcoming.length > 0 || loading) && (
          <div className="space-y-2">
            {loading ? (
              [...Array(2)].map((_, i) => (
                <div key={i} className="h-16 bg-gray-100 rounded-lg animate-pulse" />
              ))
            ) : (
              upcoming.map((drop) => (
                <Card key={drop.id}>
                  <CardContent className="p-4 flex items-center justify-between gap-4 flex-wrap">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-lg bg-gray-900 flex items-center justify-center flex-shrink-0">
                        <Rocket className="h-4 w-4 text-white" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-900">{drop.title || 'Drop sans nom'}</p>
                        <p className="text-xs text-gray-500">
                          {formatDateTime(drop.scheduled_at)} · {drop.product_ids.length} article{drop.product_ids.length > 1 ? 's' : ''}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {statusBadge(drop.status)}
                      <button
                        onClick={() => handleEdit(drop)}
                        className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                        title="Modifier"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleCancel(drop)}
                        disabled={cancellingId === drop.id}
                        className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                        title="Annuler le drop"
                      >
                        <Ban className="h-4 w-4" />
                      </button>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        )}
      </div>

      {history.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-gray-700 mb-3">Historique</h4>
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="text-left py-3 px-4 md:px-6 font-medium text-gray-900 text-sm">Drop</th>
                      <th className="text-left py-3 px-4 md:px-6 font-medium text-gray-900 text-sm">Date prévue</th>
                      <th className="text-left py-3 px-4 md:px-6 font-medium text-gray-900 text-sm hidden sm:table-cell">Articles</th>
                      <th className="text-left py-3 px-4 md:px-6 font-medium text-gray-900 text-sm">Statut</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((drop) => (
                      <tr key={drop.id} className="border-b border-gray-50">
                        <td className="py-3 px-4 md:px-6 text-sm text-gray-900">{drop.title || 'Drop sans nom'}</td>
                        <td className="py-3 px-4 md:px-6 text-sm text-gray-600">{formatDateTime(drop.scheduled_at)}</td>
                        <td className="py-3 px-4 md:px-6 hidden sm:table-cell">
                          <div className="flex items-center gap-1 text-sm text-gray-600">
                            <Package className="h-4 w-4 text-gray-400" />
                            {drop.product_ids.length}
                          </div>
                        </td>
                        <td className="py-3 px-4 md:px-6">{statusBadge(drop.status)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <CreateDropModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        onSubmit={editingDrop ? (input) => updateDrop(editingDrop.id, input) : createDrop}
        editingDrop={editingDrop}
      />
    </div>
  );
};
