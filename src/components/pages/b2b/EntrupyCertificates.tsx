import React, { useMemo, useState } from 'react';
import { BadgeCheck, AlertCircle, ImageOff, Clock, Link as LinkIcon, Upload, X, ExternalLink } from 'lucide-react';
import { Card, CardContent } from '../../ui/Card';
import { Badge } from '../../ui/Badge';
import { useAdminAuth } from '../../../hooks/useAdminAuth';
import { useEntrupyCertificates, EntrupyCertificateItem } from '../../../hooks/useEntrupyCertificates';

type StatusFilter = 'all' | 'pending' | 'completed';

const statusBadge = (status: EntrupyCertificateItem['entrupy_status']) =>
  status === 'completed' ? (
    <Badge variant="success">Terminé</Badge>
  ) : (
    <Badge variant="warning">À faire</Badge>
  );

interface ImportModalProps {
  item: EntrupyCertificateItem;
  onClose: () => void;
  onImport: (certUrl: string, pdfPath: string | null) => Promise<{ success: boolean; error?: string }>;
  onUploadPdf: (file: File) => Promise<{ success: boolean; url?: string; path?: string; error?: string }>;
}

const ImportCertificateModal: React.FC<ImportModalProps> = ({ item, onClose, onImport, onUploadPdf }) => {
  const [mode, setMode] = useState<'url' | 'file'>('url');
  const [url, setUrl] = useState(item.entrupy_cert_url || '');
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleConfirm = async () => {
    setError('');
    if (mode === 'url') {
      if (!url.trim()) {
        setError('Merci de renseigner une URL');
        return;
      }
      setSubmitting(true);
      const result = await onImport(url.trim(), null);
      setSubmitting(false);
      if (!result.success) {
        setError(result.error || 'Erreur lors de l\'import');
        return;
      }
      onClose();
      return;
    }

    if (!file) {
      setError('Merci de sélectionner un fichier PDF');
      return;
    }
    setSubmitting(true);
    const uploadResult = await onUploadPdf(file);
    if (!uploadResult.success || !uploadResult.url) {
      setSubmitting(false);
      setError(uploadResult.error || 'Erreur lors de l\'envoi du fichier');
      return;
    }
    const result = await onImport(uploadResult.url, uploadResult.path || null);
    setSubmitting(false);
    if (!result.success) {
      setError(result.error || 'Erreur lors de l\'import');
      return;
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto">
      <div className="fixed inset-0 bg-black bg-opacity-40" onClick={() => !submitting && onClose()} />
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-base font-semibold text-gray-900">
              {item.entrupy_status === 'completed' ? 'Remplacer le certificat' : 'Importer le certificat'}
            </h3>
            <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 rounded-lg transition-colors">
              <X className="h-5 w-5" />
            </button>
          </div>
          <p className="text-sm text-gray-500">{item.product_name} — {item.order_number}</p>

          <div className="flex items-center gap-2 mt-4">
            <button
              type="button"
              onClick={() => setMode('url')}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                mode === 'url' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              <LinkIcon className="h-3.5 w-3.5" /> Lien Entrupy
            </button>
            <button
              type="button"
              onClick={() => setMode('file')}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                mode === 'file' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              <Upload className="h-3.5 w-3.5" /> PDF
            </button>
          </div>

          <div className="mt-4">
            {mode === 'url' ? (
              <div>
                <label htmlFor="entrupy-url" className="block text-sm font-medium text-gray-700 mb-1">
                  URL officielle du certificat
                </label>
                <input
                  id="entrupy-url"
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://certificate.entrupy.com/..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent text-sm"
                />
              </div>
            ) : (
              <div>
                <label htmlFor="entrupy-file" className="block text-sm font-medium text-gray-700 mb-1">
                  Fichier PDF
                </label>
                <input
                  id="entrupy-file"
                  type="file"
                  accept="application/pdf"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                  className="w-full text-sm text-gray-600 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-gray-100 file:text-sm file:font-medium hover:file:bg-gray-200"
                />
              </div>
            )}
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-center space-x-2 mt-3">
              <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          <div className="flex justify-end space-x-3 mt-5">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors text-sm disabled:opacity-50"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={submitting}
              className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors text-sm font-medium disabled:opacity-50"
            >
              {submitting ? 'Import...' : 'Confirmer'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

/** Gestion et import des certificats d'authenticité Entrupy — une pièce vue
 * ici dès que order_items.entrupy_requested = true (voir 0083/0154). */
export const EntrupyCertificates: React.FC = () => {
  const { isAdmin } = useAdminAuth();
  const { items, loading, error, importCertificate, uploadPdf } = useEntrupyCertificates(isAdmin);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('pending');
  const [importingItem, setImportingItem] = useState<EntrupyCertificateItem | null>(null);

  const filteredItems = useMemo(() => {
    if (statusFilter === 'pending') return items.filter((i) => i.entrupy_status === 'pending');
    if (statusFilter === 'completed') return items.filter((i) => i.entrupy_status === 'completed');
    return items;
  }, [items, statusFilter]);

  const totalPending = items.filter((i) => i.entrupy_status === 'pending').length;
  const totalCompleted = items.filter((i) => i.entrupy_status === 'completed').length;

  return (
    <div className="p-4 md:p-6">
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-gray-900">Certificats Entrupy</h3>
        <p className="text-sm text-gray-500">Import des certificats d'authenticité pour les pièces où le revendeur en a fait la demande.</p>
      </div>

      {!loading && !error && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <Clock className="h-4 w-4 text-amber-500" />
                <p className="text-xs text-gray-500">À faire</p>
              </div>
              <p className="text-xl font-semibold text-amber-600">{totalPending}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <BadgeCheck className="h-4 w-4 text-green-500" />
                <p className="text-xs text-gray-500">Terminés</p>
              </div>
              <p className="text-xl font-semibold text-green-600">{totalCompleted}</p>
            </CardContent>
          </Card>
        </div>
      )}

      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 flex items-center space-x-3">
          <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0" />
          <p className="text-sm text-red-700">Erreur : {error}</p>
        </div>
      )}

      <div className="flex items-center gap-2 mb-4">
        {([
          { id: 'pending', label: 'À faire' },
          { id: 'completed', label: 'Terminés' },
          { id: 'all', label: 'Tous' },
        ] as { id: StatusFilter; label: string }[]).map((f) => (
          <button
            key={f.id}
            onClick={() => setStatusFilter(f.id)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              statusFilter === f.id ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {!loading && !error && filteredItems.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-gray-200 rounded-lg">
          <BadgeCheck className="h-10 w-10 text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-500">Aucun certificat Entrupy pour ce filtre.</p>
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left py-3 px-4 font-medium text-gray-900 text-sm">Article</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-900 text-sm">N° commande</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-900 text-sm">Revendeur</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-900 text-sm">Date commande</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-900 text-sm">Statut</th>
                    <th className="text-right py-3 px-4 font-medium text-gray-900 text-sm">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    [...Array(3)].map((_, i) => (
                      <tr key={`skeleton-${i}`} className="border-b border-gray-50">
                        <td className="py-4 px-4" colSpan={6}>
                          <div className="h-4 w-full bg-gray-100 rounded animate-pulse" />
                        </td>
                      </tr>
                    ))
                  ) : (
                    filteredItems.map((item) => (
                      <tr key={item.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                        <td className="py-3 px-4 text-sm text-gray-900">
                          <div className="flex items-center gap-2.5">
                            <div className="h-9 w-9 bg-gray-100 rounded flex items-center justify-center overflow-hidden flex-shrink-0">
                              {item.product_image ? (
                                <img src={item.product_image} alt={item.product_name} className="h-full w-full object-cover" />
                              ) : (
                                <ImageOff className="h-4 w-4 text-gray-300" />
                              )}
                            </div>
                            <div className="min-w-0">
                              <p className="font-medium truncate max-w-[180px]">{item.product_name}</p>
                              {item.product_reference && <p className="text-xs text-gray-400 font-mono">{item.product_reference}</p>}
                            </div>
                          </div>
                        </td>
                        <td className="py-3 px-4 text-sm text-gray-600 font-mono">{item.order_number}</td>
                        <td className="py-3 px-4 text-sm text-gray-900">
                          <p className="font-semibold">{item.reseller_company_name}</p>
                          <p className="text-xs text-gray-500">{item.requester_name}</p>
                        </td>
                        <td className="py-3 px-4 text-sm text-gray-600">
                          {item.order_created_at ? new Date(item.order_created_at).toLocaleDateString('fr-FR') : '—'}
                        </td>
                        <td className="py-3 px-4">{statusBadge(item.entrupy_status)}</td>
                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            {item.entrupy_status === 'completed' && item.entrupy_cert_url && (
                              <a
                                href={item.entrupy_cert_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-800 underline"
                              >
                                <ExternalLink className="h-3 w-3" /> Voir
                              </a>
                            )}
                            <button
                              onClick={() => setImportingItem(item)}
                              className="flex items-center gap-1 px-2.5 py-1.5 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors text-xs font-medium"
                            >
                              <BadgeCheck className="h-3 w-3" />
                              {item.entrupy_status === 'completed' ? 'Remplacer' : 'Importer le certificat'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {importingItem && (
        <ImportCertificateModal
          item={importingItem}
          onClose={() => setImportingItem(null)}
          onImport={(certUrl, pdfPath) => importCertificate(importingItem.id, certUrl, pdfPath)}
          onUploadPdf={(file) => uploadPdf(importingItem.id, file)}
        />
      )}
    </div>
  );
};

export default EntrupyCertificates;
