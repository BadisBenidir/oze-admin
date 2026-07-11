import React, { useState } from 'react';
import { Card, CardContent } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { useCoupons, Coupon, CouponFormData } from '../../hooks/useCoupons';
import { useAdminAuth } from '../../hooks/useAdminAuth';
import {
  Ticket,
  Plus,
  Edit,
  Trash2,
  AlertCircle,
  RefreshCw,
  X,
  Percent,
  Euro,
  Calendar,
  Users,
  Pause,
  Play,
  Copy,
  Check
} from 'lucide-react';

export const Coupons: React.FC = () => {
  const { isAdmin } = useAdminAuth();
  const { coupons, loading, error, refreshCoupons, createCoupon, updateCoupon, deleteCoupon, toggleCouponStatus } = useCoupons(isAdmin);

  const [showModal, setShowModal] = useState(false);
  const [editingCoupon, setEditingCoupon] = useState<Coupon | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // Form state
  const [formData, setFormData] = useState<CouponFormData>({
    code: '',
    description: '',
    discount_type: 'percentage',
    discount_value: 10,
    max_discount_amount: null,
    min_order_amount: null,
    valid_from: null,
    valid_until: null,
    max_uses: null,
    status: 'active'
  });

  const resetForm = () => {
    setFormData({
      code: '',
      description: '',
      discount_type: 'percentage',
      discount_value: 10,
      max_discount_amount: null,
      min_order_amount: null,
      valid_from: null,
      valid_until: null,
      max_uses: null,
      status: 'active'
    });
    setEditingCoupon(null);
    setFormError(null);
  };

  const openCreateModal = () => {
    resetForm();
    setShowModal(true);
  };

  const openEditModal = (coupon: Coupon) => {
    setEditingCoupon(coupon);
    setFormData({
      code: coupon.code,
      description: coupon.description || '',
      discount_type: coupon.discount_type,
      discount_value: coupon.discount_value,
      max_discount_amount: coupon.max_discount_amount,
      min_order_amount: coupon.min_order_amount,
      valid_from: coupon.valid_from ? coupon.valid_from.split('T')[0] : null,
      valid_until: coupon.valid_until ? coupon.valid_until.split('T')[0] : null,
      max_uses: coupon.max_uses,
      status: coupon.status
    });
    setFormError(null);
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    resetForm();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSaving(true);

    try {
      if (!formData.code.trim()) {
        setFormError('Le code promo est obligatoire');
        setSaving(false);
        return;
      }

      if (formData.discount_value <= 0) {
        setFormError('La valeur de réduction doit être supérieure à 0');
        setSaving(false);
        return;
      }

      if (formData.discount_type === 'percentage' && formData.discount_value > 100) {
        setFormError('Le pourcentage ne peut pas dépasser 100%');
        setSaving(false);
        return;
      }

      let result;
      if (editingCoupon) {
        result = await updateCoupon(editingCoupon.id, formData);
      } else {
        result = await createCoupon(formData);
      }

      if (result.success) {
        closeModal();
      } else {
        setFormError(result.error || 'Une erreur est survenue');
      }
    } catch (err) {
      setFormError('Une erreur est survenue');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (coupon: Coupon) => {
    if (window.confirm(`Supprimer le coupon "${coupon.code}" ?`)) {
      await deleteCoupon(coupon.id);
    }
  };

  const handleToggleStatus = async (coupon: Coupon) => {
    const newStatus = coupon.status === 'active' ? 'paused' : 'active';
    await toggleCouponStatus(coupon.id, newStatus);
  };

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'Illimité';
    return new Date(dateStr).toLocaleDateString('fr-FR');
  };

  const getStatusBadge = (coupon: Coupon) => {
    if (coupon.status === 'paused') {
      return <Badge variant="default">En pause</Badge>;
    }
    if (coupon.status === 'expired') {
      return <Badge variant="warning">Expiré</Badge>;
    }
    if (coupon.valid_until && new Date(coupon.valid_until) < new Date()) {
      return <Badge variant="warning">Expiré</Badge>;
    }
    return <Badge variant="success">Actif</Badge>;
  };

  return (
    <div className="p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Gestion des Coupons</h3>
          <p className="text-sm text-gray-500">
            {loading ? 'Chargement...' : `${coupons.length} coupon${coupons.length > 1 ? 's' : ''}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={refreshCoupons}
            className="flex items-center space-x-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
          >
            <RefreshCw className="h-4 w-4" />
            <span className="hidden sm:inline">Actualiser</span>
          </button>
          <button
            onClick={openCreateModal}
            className="flex items-center space-x-2 px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors"
          >
            <Plus className="h-4 w-4" />
            <span>Nouveau coupon</span>
          </button>
        </div>
      </div>

      {/* Error message */}
      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 flex items-center space-x-3">
          <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0" />
          <p className="text-sm text-red-700">Erreur : {error}</p>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && coupons.length === 0 && (
        <div className="text-center py-12">
          <Ticket className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">Aucun coupon</h3>
          <p className="text-gray-500 mb-6">Créez votre premier code promo</p>
          <button
            onClick={openCreateModal}
            className="inline-flex items-center space-x-2 px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors"
          >
            <Plus className="h-4 w-4" />
            <span>Créer un coupon</span>
          </button>
        </div>
      )}

      {/* Coupons list */}
      {(coupons.length > 0 || loading) && (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left py-3 px-4 md:px-6 font-medium text-gray-900 text-sm">Code</th>
                    <th className="text-left py-3 px-4 md:px-6 font-medium text-gray-900 text-sm hidden sm:table-cell">Réduction</th>
                    <th className="text-left py-3 px-4 md:px-6 font-medium text-gray-900 text-sm hidden md:table-cell">Validité</th>
                    <th className="text-left py-3 px-4 md:px-6 font-medium text-gray-900 text-sm hidden lg:table-cell">Utilisations</th>
                    <th className="text-left py-3 px-4 md:px-6 font-medium text-gray-900 text-sm">Statut</th>
                    <th className="text-left py-3 px-4 md:px-6 font-medium text-gray-900 text-sm">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    [...Array(3)].map((_, index) => (
                      <tr key={`skeleton-${index}`} className="border-b border-gray-50">
                        <td className="py-4 px-4 md:px-6">
                          <div className="h-6 w-24 bg-gray-200 rounded animate-pulse"></div>
                        </td>
                        <td className="py-4 px-4 md:px-6 hidden sm:table-cell">
                          <div className="h-4 w-16 bg-gray-200 rounded animate-pulse"></div>
                        </td>
                        <td className="py-4 px-4 md:px-6 hidden md:table-cell">
                          <div className="h-4 w-32 bg-gray-200 rounded animate-pulse"></div>
                        </td>
                        <td className="py-4 px-4 md:px-6 hidden lg:table-cell">
                          <div className="h-4 w-12 bg-gray-200 rounded animate-pulse"></div>
                        </td>
                        <td className="py-4 px-4 md:px-6">
                          <div className="h-6 w-16 bg-gray-200 rounded animate-pulse"></div>
                        </td>
                        <td className="py-4 px-4 md:px-6">
                          <div className="h-6 w-20 bg-gray-200 rounded animate-pulse"></div>
                        </td>
                      </tr>
                    ))
                  ) : (
                    coupons.map((coupon) => (
                      <tr key={coupon.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                        <td className="py-4 px-4 md:px-6">
                          <div className="flex items-center space-x-2">
                            <code className="bg-gray-100 px-2 py-1 rounded text-sm font-mono font-semibold text-gray-900">
                              {coupon.code}
                            </code>
                            <button
                              onClick={() => copyCode(coupon.code)}
                              className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
                              title="Copier le code"
                            >
                              {copiedCode === coupon.code ? (
                                <Check className="h-4 w-4 text-green-500" />
                              ) : (
                                <Copy className="h-4 w-4" />
                              )}
                            </button>
                          </div>
                          {coupon.description && (
                            <p className="text-xs text-gray-500 mt-1">{coupon.description}</p>
                          )}
                        </td>
                        <td className="py-4 px-4 md:px-6 hidden sm:table-cell">
                          <div className="flex items-center space-x-1">
                            {coupon.discount_type === 'percentage' ? (
                              <>
                                <Percent className="h-4 w-4 text-gray-400" />
                                <span className="font-semibold">{coupon.discount_value}%</span>
                              </>
                            ) : (
                              <>
                                <Euro className="h-4 w-4 text-gray-400" />
                                <span className="font-semibold">{coupon.discount_value}€</span>
                              </>
                            )}
                          </div>
                          {coupon.min_order_amount && (
                            <p className="text-xs text-gray-500">Min: {coupon.min_order_amount}€</p>
                          )}
                        </td>
                        <td className="py-4 px-4 md:px-6 hidden md:table-cell">
                          <div className="flex items-center space-x-1 text-sm text-gray-600">
                            <Calendar className="h-4 w-4 text-gray-400" />
                            <span>
                              {coupon.valid_until
                                ? `Jusqu'au ${formatDate(coupon.valid_until)}`
                                : 'Illimité'
                              }
                            </span>
                          </div>
                        </td>
                        <td className="py-4 px-4 md:px-6 hidden lg:table-cell">
                          <div className="flex items-center space-x-1 text-sm">
                            <Users className="h-4 w-4 text-gray-400" />
                            <span>
                              {coupon.uses_count}
                              {coupon.max_uses ? ` / ${coupon.max_uses}` : ''}
                            </span>
                          </div>
                        </td>
                        <td className="py-4 px-4 md:px-6">
                          {getStatusBadge(coupon)}
                        </td>
                        <td className="py-4 px-4 md:px-6">
                          <div className="flex items-center space-x-1">
                            <button
                              onClick={() => handleToggleStatus(coupon)}
                              className={`p-2 rounded-lg transition-colors ${
                                coupon.status === 'active'
                                  ? 'text-orange-600 hover:bg-orange-50'
                                  : 'text-green-600 hover:bg-green-50'
                              }`}
                              title={coupon.status === 'active' ? 'Mettre en pause' : 'Activer'}
                            >
                              {coupon.status === 'active' ? (
                                <Pause className="h-4 w-4" />
                              ) : (
                                <Play className="h-4 w-4" />
                              )}
                            </button>
                            <button
                              onClick={() => openEditModal(coupon)}
                              className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                              title="Modifier"
                            >
                              <Edit className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => handleDelete(coupon)}
                              className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                              title="Supprimer"
                            >
                              <Trash2 className="h-4 w-4" />
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

      {/* Modal Create/Edit */}
      {showModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <div className="fixed inset-0 bg-black bg-opacity-25" onClick={closeModal}></div>

            <div className="relative bg-white rounded-xl shadow-xl w-full max-w-lg p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-semibold text-gray-900">
                  {editingCoupon ? 'Modifier le coupon' : 'Nouveau coupon'}
                </h3>
                <button
                  onClick={closeModal}
                  className="p-2 text-gray-400 hover:text-gray-600 rounded-lg transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {formError && (
                <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-3 flex items-center space-x-2">
                  <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0" />
                  <p className="text-sm text-red-700">{formError}</p>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                {/* Code */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Code promo *
                  </label>
                  <input
                    type="text"
                    value={formData.code}
                    onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent uppercase font-mono"
                    placeholder="BIENVENUE"
                    required
                  />
                </div>

                {/* Description */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Description (interne)
                  </label>
                  <input
                    type="text"
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                    placeholder="Coupon de bienvenue pour nouveaux clients"
                  />
                </div>

                {/* Type + Value */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Type de réduction
                    </label>
                    <select
                      value={formData.discount_type}
                      onChange={(e) => setFormData({ ...formData, discount_type: e.target.value as 'percentage' | 'fixed_amount' })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                    >
                      <option value="percentage">Pourcentage (%)</option>
                      <option value="fixed_amount">Montant fixe (€)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Valeur *
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        value={formData.discount_value}
                        onChange={(e) => setFormData({ ...formData, discount_value: parseFloat(e.target.value) || 0 })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent pr-10"
                        min="0"
                        step="0.01"
                        required
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
                        {formData.discount_type === 'percentage' ? '%' : '€'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Max discount (for percentage) */}
                {formData.discount_type === 'percentage' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Plafond de réduction (optionnel)
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        value={formData.max_discount_amount || ''}
                        onChange={(e) => setFormData({ ...formData, max_discount_amount: e.target.value ? parseFloat(e.target.value) : null })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent pr-10"
                        min="0"
                        step="0.01"
                        placeholder="Ex: 50"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">€</span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">Laisser vide pour pas de plafond</p>
                  </div>
                )}

                {/* Min order */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Montant minimum de commande (optionnel)
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      value={formData.min_order_amount || ''}
                      onChange={(e) => setFormData({ ...formData, min_order_amount: e.target.value ? parseFloat(e.target.value) : null })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent pr-10"
                      min="0"
                      step="0.01"
                      placeholder="Ex: 100"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">€</span>
                  </div>
                </div>

                {/* Validity dates */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Valide à partir du
                    </label>
                    <input
                      type="date"
                      value={formData.valid_from || ''}
                      onChange={(e) => setFormData({ ...formData, valid_from: e.target.value || null })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Valide jusqu'au
                    </label>
                    <input
                      type="date"
                      value={formData.valid_until || ''}
                      onChange={(e) => setFormData({ ...formData, valid_until: e.target.value || null })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                    />
                    <p className="text-xs text-gray-500 mt-1">Laisser vide = illimité</p>
                  </div>
                </div>

                {/* Max uses */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Nombre maximum d'utilisations (optionnel)
                  </label>
                  <input
                    type="number"
                    value={formData.max_uses || ''}
                    onChange={(e) => setFormData({ ...formData, max_uses: e.target.value ? parseInt(e.target.value) : null })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                    min="1"
                    placeholder="Illimité"
                  />
                  <p className="text-xs text-gray-500 mt-1">Laisser vide = illimité. Note: 1 utilisation par email</p>
                </div>

                {/* Buttons */}
                <div className="flex justify-end space-x-3 pt-4">
                  <button
                    type="button"
                    onClick={closeModal}
                    className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                  >
                    Annuler
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50"
                  >
                    {saving ? 'Enregistrement...' : editingCoupon ? 'Modifier' : 'Créer'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};