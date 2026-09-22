import React, { useMemo, useState } from 'react';
import {
  BadgeCheck, AlertCircle, ImageOff, Link as LinkIcon, Upload, X, ExternalLink,
  Trash2, Euro, TrendingUp, TrendingDown, Wallet, Pencil, Check, Eye, Package,
} from 'lucide-react';
import { Card, CardContent } from '../../ui/Card';
import { Badge } from '../../ui/Badge';
import { useAdminAuth } from '../../../hooks/useAdminAuth';
import { useEntrupyCertificates, useEntrupyManualAdjustment, EntrupyCertificateItem } from '../../../hooks/useEntrupyCertificates';

type StatusFilter = 'all' | 'pending' | 'completed';

// Contrat Entrupy (forfait "Petit Unified Monthly USD") — constantes de
// tarification, pas de donnée métier variable : pas besoin d'une table de
// configuration pour ça, seul l'ajustement manuel mensuel (voir
// useEntrupyManualAdjustment / 0155) est réellement dynamique.
const SUBSCRIPTION_USD = 139;
const QUOTA_INCLUDED = 25;
const ADDON_USD = 5.6;
const USD_TO_EUR = 0.92;
const SALE_PRICE_EUR = 19.99;
const BREAKEVEN_COUNT = 7;

const isSameMonth = (isoDate: string, ref: Date): boolean => {
  const d = new Date(isoDate);
  return d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth();
};

const eur = (n: number) => n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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

interface ArticleDetailModalProps {
  item: EntrupyCertificateItem;
  onClose: () => void;
}

/** Détail de l'article (pas de toute la commande) — tout ce qu'affiche déjà
 * la ligne du tableau vient de `item` (useEntrupyCertificates), pas besoin
 * de re-fetcher quoi que ce soit pour cette vue en lecture seule. */
const ArticleDetailModal: React.FC<ArticleDetailModalProps> = ({ item, onClose }) => {
  const images = item.product_images.length > 0 ? item.product_images : item.product_image ? [item.product_image] : [];
  const [activeIndex, setActiveIndex] = useState(0);
  const [lightbox, setLightbox] = useState(false);

  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto">
      <div className="fixed inset-0 bg-black bg-opacity-40" onClick={onClose} />
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold text-gray-900">Détail de l'article</h3>
            <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 rounded-lg transition-colors">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="mb-4">
            <button
              type="button"
              onClick={() => images.length > 0 && setLightbox(true)}
              className="w-full aspect-square bg-gray-100 rounded-lg flex items-center justify-center overflow-hidden"
              title={images.length > 0 ? 'Voir en grand' : undefined}
            >
              {images[activeIndex] ? (
                <img src={images[activeIndex]} alt={item.product_name} className="h-full w-full object-cover" />
              ) : (
                <Package className="h-10 w-10 text-gray-300" />
              )}
            </button>
            {images.length > 1 && (
              <div className="flex items-center gap-2 mt-2 overflow-x-auto">
                {images.map((img, idx) => (
                  <button
                    key={img + idx}
                    type="button"
                    onClick={() => setActiveIndex(idx)}
                    className={`h-12 w-12 flex-shrink-0 rounded-lg overflow-hidden border-2 transition-colors ${
                      idx === activeIndex ? 'border-gray-900' : 'border-transparent hover:border-gray-300'
                    }`}
                  >
                    <img src={img} alt={`${item.product_name} ${idx + 1}`} className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            )}
            <div className="mt-3">
              <p className="font-medium text-gray-900">{item.product_name}</p>
              {item.product_reference && <p className="text-xs text-gray-400 font-mono">{item.product_reference}</p>}
            </div>
          </div>

          <div className="space-y-2.5 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">N° commande</span>
              <span className="text-gray-900 font-mono">{item.order_number}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Date de commande</span>
              <span className="text-gray-900">{item.order_created_at ? new Date(item.order_created_at).toLocaleDateString('fr-FR') : '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Revendeur</span>
              <span className="text-gray-900 text-right">{item.reseller_company_name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Demandé par</span>
              <span className="text-gray-900 text-right">{item.requester_name}{item.requester_email ? ` (${item.requester_email})` : ''}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Quantité</span>
              <span className="text-gray-900">{item.quantity}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Prix unitaire</span>
              <span className="text-gray-900">{item.unit_price.toFixed(2)} €</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Total ligne</span>
              <span className="text-gray-900 font-semibold">{item.line_total.toFixed(2)} €</span>
            </div>
            <div className="flex justify-between items-center pt-2 border-t border-gray-100">
              <span className="text-gray-500">Certificat Entrupy</span>
              {statusBadge(item.entrupy_status)}
            </div>
            {item.entrupy_status === 'completed' && item.entrupy_completed_at && (
              <div className="flex justify-between">
                <span className="text-gray-500">Édité le</span>
                <span className="text-gray-900">{new Date(item.entrupy_completed_at).toLocaleDateString('fr-FR')}</span>
              </div>
            )}
            {item.entrupy_cert_url && (
              <a
                href={item.entrupy_cert_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-1.5 mt-2 px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors text-sm font-medium"
              >
                <ExternalLink className="h-3.5 w-3.5" /> Voir le certificat
              </a>
            )}
          </div>
        </div>
      </div>

      {lightbox && images[activeIndex] && (
        <div className="fixed inset-0 z-[70] bg-black bg-opacity-90 flex items-center justify-center p-4" onClick={() => setLightbox(false)}>
          <button
            onClick={() => setLightbox(false)}
            className="absolute top-4 right-4 p-2 text-white/80 hover:text-white rounded-lg transition-colors"
          >
            <X className="h-6 w-6" />
          </button>
          {images.length > 1 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setActiveIndex((prev) => (prev - 1 + images.length) % images.length);
              }}
              className="absolute left-4 top-1/2 -translate-y-1/2 p-2 text-white/80 hover:text-white text-3xl leading-none rounded-full bg-white/10 hover:bg-white/20 transition-colors w-10 h-10 flex items-center justify-center"
            >
              ‹
            </button>
          )}
          <img
            src={images[activeIndex]}
            alt={item.product_name}
            className="max-h-[90vh] max-w-[90vw] object-contain"
            onClick={(e) => e.stopPropagation()}
          />
          {images.length > 1 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setActiveIndex((prev) => (prev + 1) % images.length);
              }}
              className="absolute right-4 top-1/2 -translate-y-1/2 p-2 text-white/80 hover:text-white text-3xl leading-none rounded-full bg-white/10 hover:bg-white/20 transition-colors w-10 h-10 flex items-center justify-center"
            >
              ›
            </button>
          )}
        </div>
      )}
    </div>
  );
};

interface ManualAdjustmentEditorProps {
  count: number;
  saving: boolean;
  onSave: (value: number) => Promise<{ success: boolean; error?: string }>;
}

/** Certificats réalisés manuellement hors plateforme ce mois — éditable en
 * ligne, comptés dans le quota/CA du mois à côté des certificats importés
 * ici (voir useEntrupyManualAdjustment). */
const ManualAdjustmentEditor: React.FC<ManualAdjustmentEditorProps> = ({ count, saving, onSave }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(count));

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setDraft(String(count));
          setEditing(true);
        }}
        className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800 underline decoration-dotted"
      >
        <Pencil className="h-3 w-3" />
        dont {count} hors plateforme
      </button>
    );
  }

  return (
    <div className="inline-flex items-center gap-1.5">
      <input
        type="number"
        min={0}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        className="w-16 px-2 py-1 border border-gray-300 rounded text-xs"
        autoFocus
      />
      <button
        type="button"
        disabled={saving}
        onClick={async () => {
          const value = Math.max(0, parseInt(draft, 10) || 0);
          const result = await onSave(value);
          if (result.success) setEditing(false);
        }}
        className="p-1 bg-gray-900 text-white rounded hover:bg-gray-800 disabled:opacity-50"
        title="Enregistrer"
      >
        <Check className="h-3 w-3" />
      </button>
      <button type="button" onClick={() => setEditing(false)} className="p-1 text-gray-400 hover:text-gray-600" title="Annuler">
        <X className="h-3 w-3" />
      </button>
    </div>
  );
};

/** Gestion et import des certificats d'authenticité Entrupy — une pièce vue
 * ici dès que order_items.entrupy_requested = true (voir 0083/0154). */
export const EntrupyCertificates: React.FC = () => {
  const { isAdmin } = useAdminAuth();
  const { items, loading, error, importCertificate, uploadPdf, deleteCertificate } = useEntrupyCertificates(isAdmin);
  const manualAdjustment = useEntrupyManualAdjustment(isAdmin);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('pending');
  const [importingItem, setImportingItem] = useState<EntrupyCertificateItem | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [viewingItem, setViewingItem] = useState<EntrupyCertificateItem | null>(null);

  // `items` arrive déjà triés du plus vieux au plus récent (voir
  // useEntrupyCertificates). Dans l'onglet "Tous", les certificats terminés
  // passent sous les "à faire" plutôt que de rester mélangés par date, pour
  // que les plus anciens non traités restent toujours visibles en premier.
  const filteredItems = useMemo(() => {
    const pending = items.filter((i) => i.entrupy_status === 'pending');
    const completed = items.filter((i) => i.entrupy_status === 'completed');
    if (statusFilter === 'pending') return pending;
    if (statusFilter === 'completed') return completed;
    return [...pending, ...completed];
  }, [items, statusFilter]);

  const now = new Date();
  // Quota/coût Entrupy réel : consommé au moment de l'authentification
  // physique (édition du certificat), pas de la demande.
  const completedThisMonth = items.filter((i) => i.entrupy_status === 'completed' && i.entrupy_completed_at && isSameMonth(i.entrupy_completed_at, now)).length;
  const quotaRealized = completedThisMonth + manualAdjustment.count;
  const overQuota = Math.max(quotaRealized - QUOTA_INCLUDED, 0);
  const costUsd = quotaRealized <= QUOTA_INCLUDED ? SUBSCRIPTION_USD : SUBSCRIPTION_USD + overQuota * ADDON_USD;
  const costEur = costUsd * USD_TO_EUR;
  const breakEvenReached = quotaRealized >= BREAKEVEN_COUNT;

  // CA réel : le revendeur paie les 19,99 € à la DEMANDE du certificat, pas
  // à son édition (voir paid_at, useEntrupyCertificates) — un article encore
  // "à faire" ce mois-ci est déjà encaissé et compte donc dans le CA.
  const paidThisMonth = items.filter((i) => i.paid_at && isSameMonth(i.paid_at, now)).length;
  const paidRealized = paidThisMonth + manualAdjustment.count;
  const revenueEur = paidRealized * SALE_PRICE_EUR;
  const profitEur = revenueEur - costEur;

  return (
    <div className="p-4 md:p-6">
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-gray-900">Certificats Entrupy</h3>
        <p className="text-sm text-gray-500">Import des certificats d'authenticité pour les pièces où le revendeur en a fait la demande.</p>
      </div>

      {!loading && !error && (
        <div className="mb-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <BadgeCheck className="h-4 w-4 text-gray-400" />
                  <p className="text-xs text-gray-500">Réalisés ce mois</p>
                </div>
                <p className="text-xl font-semibold text-gray-900">{quotaRealized}</p>
                {!manualAdjustment.loading && (
                  <div className="mt-1">
                    <ManualAdjustmentEditor count={manualAdjustment.count} saving={manualAdjustment.saving} onSave={manualAdjustment.setCount} />
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <Wallet className="h-4 w-4 text-gray-400" />
                  <p className="text-xs text-gray-500">Quota consommé</p>
                </div>
                <p className="text-xl font-semibold text-gray-900">
                  {Math.min(quotaRealized, QUOTA_INCLUDED)} / {QUOTA_INCLUDED}
                </p>
                {overQuota > 0 && <p className="text-xs text-amber-600 mt-1">+{overQuota} hors forfait</p>}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <Euro className="h-4 w-4 text-gray-400" />
                  <p className="text-xs text-gray-500">Chiffre d'affaires</p>
                </div>
                <p className="text-xl font-semibold text-gray-900">{eur(revenueEur)} €</p>
                <p className="text-xs text-gray-400 mt-1">{paidRealized} certificat{paidRealized > 1 ? 's' : ''} payé{paidRealized > 1 ? 's' : ''}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <TrendingDown className="h-4 w-4 text-gray-400" />
                  <p className="text-xs text-gray-500">Coût Entrupy total</p>
                </div>
                <p className="text-xl font-semibold text-gray-900">{eur(costEur)} €</p>
                <p className="text-xs text-gray-400 mt-1">
                  {overQuota > 0 ? `139 $ + ${overQuota} × 5,60 $` : '139 $ (forfait)'}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <TrendingUp className={`h-4 w-4 ${profitEur >= 0 ? 'text-green-500' : 'text-red-500'}`} />
                  <p className="text-xs text-gray-500">Bénéfice net</p>
                </div>
                <p className={`text-xl font-semibold ${profitEur >= 0 ? 'text-green-600' : 'text-red-600'}`}>{eur(profitEur)} €</p>
              </CardContent>
            </Card>
          </div>
          <p className={`text-xs mt-2 ${breakEvenReached ? 'text-green-600' : 'text-gray-400'}`}>
            {breakEvenReached
              ? `Seuil de rentabilité atteint (${BREAKEVEN_COUNT}ᵉ certificat du mois passé)`
              : `Seuil de rentabilité à ${BREAKEVEN_COUNT} certificats — encore ${BREAKEVEN_COUNT - quotaRealized} ce mois-ci`}
          </p>
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
                      <tr
                        key={item.id}
                        onClick={() => setViewingItem(item)}
                        className="border-b border-gray-50 hover:bg-gray-50 transition-colors cursor-pointer"
                      >
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
                        <td className="py-3 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => setViewingItem(item)}
                              className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                              title="Voir le détail de l'article"
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </button>
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
                            {item.entrupy_status === 'completed' && (
                              <button
                                onClick={async () => {
                                  if (!window.confirm('Supprimer ce certificat ? L\'article repassera en "À faire".')) return;
                                  setDeletingId(item.id);
                                  await deleteCertificate(item.id);
                                  setDeletingId(null);
                                }}
                                disabled={deletingId === item.id}
                                title="Supprimer le certificat"
                                className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
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

      {viewingItem && <ArticleDetailModal item={viewingItem} onClose={() => setViewingItem(null)} />}
    </div>
  );
};

export default EntrupyCertificates;
