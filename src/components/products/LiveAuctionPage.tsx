import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Card, CardContent } from '../ui/Card';
import { Modal } from '../ui/Modal';
import { ProductLabel } from './ProductLabel';
import { LiveProductForm } from './LiveProductForm';
import { Package, Edit, Eye, Tag, Trash2, Image as ImageIcon, AlertCircle, Gavel, CheckCircle, Plus } from 'lucide-react';

type AuctionStatus = 'for-auction-live' | 'sold-auction';

interface AuctionProduct {
  id: string;
  name: string;
  reference: string | null;
  barcode: string | null;
  images: string[];
  main_image_index: number;
  sale_price: number;
  status: AuctionStatus;
  condition: string | null;
  created_at: string;
  brand?: { name: string } | null;
}

interface LiveAuctionPageProps {
  /** Conservé pour compat ; l'édition Live se fait désormais via le formulaire dédié. */
  onEdit?: (productId: string) => void;
  /** Ouvre la fiche détail du produit. */
  onView: (productId: string) => void;
}

// Convertit une saisie texte (virgule ou point) en nombre ; 0 si vide/invalide.
const parseAmount = (value: string): number => {
  const n = parseFloat((value || '').replace(',', '.'));
  return isNaN(n) ? 0 : n;
};

/**
 * Espace « Live enchères » : articles destinés à être vendus hors site lors
 * d'un live d'enchères. Saisis comme un produit normal (fiche + étiquette/QR)
 * mais isolés ici et JAMAIS affichés sur la boutique publique. Deux statuts :
 *   - for-auction-live : à vendre en live
 *   - sold-auction     : vendu en live (clôturé)
 */
export const LiveAuctionPage: React.FC<LiveAuctionPageProps> = ({ onView }) => {
  const [items, setItems] = useState<AuctionProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [labelProduct, setLabelProduct] = useState<{ name: string; reference: string; brandName?: string } | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  // Cible de la vente en cours de clôture + prix saisi.
  const [sellTarget, setSellTarget] = useState<{ id: string; name: string } | null>(null);
  const [sellPrice, setSellPrice] = useState('');
  const [saving, setSaving] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  const fetchAuction = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase
      .from('products')
      .select('id, name, reference, barcode, images, main_image_index, sale_price, status, condition, created_at, brand:brands(name)')
      .in('status', ['for-auction-live', 'sold-auction'])
      .order('created_at', { ascending: false });
    if (error) setError(error.message);
    else setItems((data as unknown as AuctionProduct[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchAuction();
  }, [fetchAuction]);

  const openSellModal = (id: string, name: string, currentPrice: number) => {
    setSellTarget({ id, name });
    // Pré-remplit avec le prix existant s'il y en a un, sinon vide.
    setSellPrice(currentPrice > 0 ? String(currentPrice) : '');
    setMessage(null);
  };

  const confirmSell = async () => {
    if (!sellTarget) return;
    const price = parseAmount(sellPrice);
    if (price <= 0) {
      setMessage({ ok: false, text: 'Saisis un prix de vente valide (supérieur à 0).' });
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from('products')
      .update({ status: 'sold-auction', sale_price: price })
      .eq('id', sellTarget.id);
    setSaving(false);
    if (error) {
      setMessage({ ok: false, text: `Impossible de clôturer « ${sellTarget.name} » : ${error.message}` });
      return;
    }
    setMessage({ ok: true, text: `${sellTarget.name} vendu en live à ${price.toFixed(2)} € ✅` });
    setSellTarget(null);
    setSellPrice('');
    fetchAuction();
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Supprimer définitivement le produit « ${name} » ?`)) return;
    const { error } = await supabase.from('products').delete().eq('id', id);
    if (error) {
      setMessage({ ok: false, text: `Suppression impossible : ${error.message}` });
      return;
    }
    fetchAuction();
  };

  const toSellItems = items.filter((p) => p.status === 'for-auction-live');
  const soldItems = items.filter((p) => p.status === 'sold-auction');

  const renderCard = (product: AuctionProduct) => {
    const thumb = product.images?.[product.main_image_index] || product.images?.[0];
    const photoCount = product.images?.length || 0;
    const isSold = product.status === 'sold-auction';
    return (
      <Card key={product.id}>
        <CardContent className="p-4">
          <div className="flex gap-3">
            <div className="h-16 w-16 flex-shrink-0 rounded-lg bg-gray-100 overflow-hidden flex items-center justify-center">
              {thumb ? (
                <img src={thumb} alt={product.name} className="h-full w-full object-cover" />
              ) : (
                <Package className="h-6 w-6 text-gray-400" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="font-medium text-gray-900 truncate">{product.name}</p>
                <span className={`flex-shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${isSold ? 'bg-pink-100 text-pink-800' : 'bg-indigo-100 text-indigo-800'}`}>
                  {isSold ? 'Vendu' : 'À vendre'}
                </span>
              </div>
              <p className="text-xs text-gray-500 truncate">{product.brand?.name || 'Sans marque'}</p>
              {product.reference && (
                <p className="mt-0.5 font-mono text-xs text-gray-600">{product.reference}</p>
              )}
              {product.condition && (
                <span className="mt-1 inline-flex items-center px-2 py-0.5 rounded border border-gray-300 text-xs font-semibold text-gray-700">
                  État {product.condition}
                </span>
              )}
              <p className={`mt-0.5 text-sm font-medium ${product.sale_price > 0 ? 'text-gray-900' : 'text-orange-600'}`}>
                {product.sale_price > 0 ? `${product.sale_price.toFixed(2)} €` : 'Prix à définir'}
              </p>
              <p className={`mt-1 inline-flex items-center gap-1 text-xs ${photoCount === 0 ? 'text-orange-600' : 'text-gray-500'}`}>
                <ImageIcon className="h-3 w-3" />
                {photoCount} photo{photoCount > 1 ? 's' : ''}
              </p>
            </div>
          </div>

          {!isSold && (
            <button
              onClick={() => openSellModal(product.id, product.name, product.sale_price)}
              className="mt-3 w-full flex items-center justify-center gap-1 px-2 py-2 text-sm text-white bg-pink-600 rounded-lg hover:bg-pink-700 transition-colors"
              title="Clôturer : marquer comme vendu en live"
            >
              <CheckCircle className="h-4 w-4" /> Marquer comme vendu
            </button>
          )}

          <div className="mt-3 flex items-center gap-1 border-t border-gray-100 pt-3">
            <button
              onClick={() => { setEditId(product.id); setFormOpen(true); }}
              className="flex-1 flex items-center justify-center gap-1 px-2 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              title="Éditer l'article Live"
            >
              <Edit className="h-4 w-4" /> Éditer
            </button>
            <button
              onClick={() => onView(product.id)}
              className="p-2 text-gray-400 hover:text-blue-600 transition-colors"
              title="Voir la fiche"
            >
              <Eye className="h-4 w-4" />
            </button>
            <button
              onClick={() => product.reference && setLabelProduct({
                name: product.name,
                reference: product.reference,
                brandName: product.brand?.name,
              })}
              disabled={!product.reference}
              className="p-2 text-gray-400 hover:text-gray-900 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              title="Étiquette"
            >
              <Tag className="h-4 w-4" />
            </button>
            <button
              onClick={() => handleDelete(product.id, product.name)}
              className="p-2 text-gray-400 hover:text-red-600 transition-colors"
              title="Supprimer"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="p-4 md:p-6">
      <div className="mb-4 md:mb-6 flex items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Gavel className="h-5 w-5 text-indigo-600" />
            Live enchères
          </h3>
          <p className="text-sm text-gray-500">
            {loading
              ? 'Chargement...'
              : `${items.length} article${items.length > 1 ? 's' : ''} • ${toSellItems.length} à vendre • ${soldItems.length} vendu${soldItems.length > 1 ? 's' : ''}`}
          </p>
        </div>
        <button
          onClick={() => { setEditId(null); setFormOpen(true); }}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors text-sm font-medium"
        >
          <Plus className="h-4 w-4" />
          Nouvel article Live
        </button>
      </div>

      <div className="mb-4 rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-sm text-indigo-800">
        Ces articles sont vendus <strong>hors site</strong> (live d'enchères) : ils ne s'affichent jamais sur la boutique.
        Utilise le bouton <strong>« Nouvel article Live »</strong> pour en créer un (titre, marque, catégorie, état, prix d'achat, photos).
      </div>

      {message && (
        <div className={`mb-4 rounded-lg border p-3 text-sm ${message.ok ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-700'}`}>
          {message.text}
        </div>
      )}

      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-3">
          <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {!loading && items.length === 0 && !error && (
        <Card>
          <CardContent className="p-10 text-center text-gray-500">
            <Gavel className="h-10 w-10 mx-auto mb-3 text-gray-300" />
            Aucun article en live enchères. Clique sur « Nouvel article Live » pour en créer un.
          </CardContent>
        </Card>
      )}

      {/* Section : à vendre */}
      {toSellItems.length > 0 && (
        <section className="mb-8">
          <div className="flex items-center gap-2 mb-3">
            <span className="h-2.5 w-2.5 rounded-full bg-indigo-500" />
            <h4 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">À vendre ({toSellItems.length})</h4>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {toSellItems.map(renderCard)}
          </div>
        </section>
      )}

      {/* Section : vendus */}
      {soldItems.length > 0 && (
        <section className="mb-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="h-2.5 w-2.5 rounded-full bg-pink-500" />
            <h4 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">Vendus ({soldItems.length})</h4>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {soldItems.map(renderCard)}
          </div>
        </section>
      )}

      {/* Formulaire de création / modification simplifié */}
      <LiveProductForm
        isOpen={formOpen}
        productId={editId}
        onClose={() => { setFormOpen(false); setEditId(null); }}
        onSaved={({ name, reference, edited }) => {
          setMessage({
            ok: true,
            text: edited
              ? `Article « ${name} » modifié ✅`
              : `Article « ${name} » créé${reference ? ` (réf. ${reference})` : ''} ✅`,
          });
          fetchAuction();
        }}
      />

      {/* Modale étiquette */}
      <Modal isOpen={Boolean(labelProduct)} onClose={() => setLabelProduct(null)} title="Étiquette produit">
        {labelProduct && (
          <ProductLabel name={labelProduct.name} reference={labelProduct.reference} brandName={labelProduct.brandName} />
        )}
      </Modal>

      {/* Modale : prix de vente lors de la clôture */}
      <Modal isOpen={Boolean(sellTarget)} onClose={() => { if (!saving) { setSellTarget(null); setSellPrice(''); } }} title="Marquer comme vendu">
        {sellTarget && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Article : <span className="font-medium text-gray-900">{sellTarget.name}</span>
            </p>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Prix vendu (€) *</label>
              <input
                type="text"
                inputMode="decimal"
                autoFocus
                value={sellPrice}
                onChange={(e) => setSellPrice(e.target.value.replace(/[^0-9.,]/g, ''))}
                onKeyDown={(e) => { if (e.key === 'Enter') confirmSell(); }}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-pink-500"
                placeholder="Ex: 1200"
              />
              <p className="mt-1 text-xs text-gray-500">
                Ce montant est enregistré comme prix de vente et comptabilisé dans le chiffre d'affaires.
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setSellTarget(null); setSellPrice(''); }}
                disabled={saving}
                className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-50"
              >
                Annuler
              </button>
              <button
                onClick={confirmSell}
                disabled={saving}
                className="flex items-center gap-1 px-4 py-2 text-sm text-white bg-pink-600 rounded-lg hover:bg-pink-700 disabled:opacity-50"
              >
                <CheckCircle className="h-4 w-4" />
                {saving ? 'Enregistrement...' : 'Confirmer la vente'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};