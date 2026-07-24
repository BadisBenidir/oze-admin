import React, { useState } from 'react';
import { Card, CardContent } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { useAdminAuth } from '../../hooks/useAdminAuth';
import { useB2BPromoCodes, PromoCode, PromoCodeFormData } from '../../hooks/useB2BPromoCodes';
import {
  Ticket, Plus, Trash2, AlertCircle, RefreshCw, X, Percent, Euro, Calendar, Users, Pause, Play,
} from 'lucide-react';

const emptyForm: PromoCodeFormData = {
  code: '',
  discount_type: 'percentage',
  discount_value: 10,
  min_order_amount: null,
  max_uses: null,
  valid_until: null,
  status: 'active',
};

// datetime-local n'accepte pas le "Z" final ni les secondes — tronque au format attendu.
const toDatetimeLocalValue = (iso: string): string => iso.slice(0, 16);

export const B2BPromoCodes: React.FC = () => {
  const { isAdmin } = useAdminAuth();
  const { promoCodes, loading, error, refresh, createPromoCode, togglePromoCodeStatus, deletePromoCode } = useB2BPromoCodes(isAdmin);

  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState<PromoCodeFormData>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const openCreateModal = () => {
    setFormData(emptyForm);
    setFormError(null);
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setFormData(emptyForm);
    setFormError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!formData.code.trim()) {
      setFormError('Le code promo est obligatoire');
      return;
    }
    if (formData.discount_value <= 0) {
      setFormError('La valeur de réduction doit être supérieure à 0');
      return;
    }
    if (formData.discount_type === 'percentage' && formData.discount_value > 100) {
      setFormError('Le pourcentage ne peut pas dépasser 100%');
      return;
    }

    setSaving(true);
    const result = await createPromoCode(formData);
    setSaving(false);

    if (result.success) {
      closeModal();
    } else {
      setFormError(result.error || 'Une erreur est survenue');
    }
  };

  const handleDelete = async (code: PromoCode) => {
    if (window.confirm(`Supprimer le code promo "${code.code}" ? Cette action est irréversible.`)) {
      await deletePromoCode(code.id);
    }
  };

  const handleToggleStatus = async (code: PromoCode) => {
    await togglePromoCodeStatus(code.id, code.status === 'active' ? 'inactive' : 'active');
  };

  const isExpired = (code: PromoCode) => Boolean(code.valid_until && new Date(code.valid_until) <= new Date());

  const statusBadge = (code: PromoCode) => {
    if (isExpired(code)) return <Badge variant="warning">Expiré</Badge>;
    if (code.status === 'inactive') return <Badge variant="default">Inactif</Badge>;
    return <Badge variant="success">Actif</Badge>;
  };

  return (
    <div className="p-4 md:p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Codes Promos B2B</h3>
          <p className="text-sm text-gray-500">
            {loading ? 'Chargement...' : `${promoCodes.length} code${promoCodes.length > 1 ? 's' : ''}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={refresh}
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
            <span>Créer un code promo</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 flex items-center space-x-3">
          <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0" />
          <p className="text-sm text-red-700">Erreur : {error}</p>
        </div>
      )}

      {!loading && !error && promoCodes.length === 0 && (
        <div className="text-center py-12">
          <Ticket className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">Aucun code promo</h3>
          <p className="text-gray-500 mb-6">Créez votre premier code promo pour vos revendeurs</p>
          <button
            onClick={openCreateModal}
            className="inline-flex items-center space-x-2 px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors"
          >
            <Plus className="h-4 w-4" />
            <span>Créer un code promo</span>
          </button>
        </div>
      )}

      {(promoCodes.length > 0 || loading) && (
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
                    [...Array(3)].map((_, i) => (
                      <tr key={`skeleton-${i}`} className="border-b border-gray-50">
                        <td className="py-4 px-4 md:px-6" colSpan={6}>
                          <div className="h-4 w-full bg-gray-100 rounded animate-pulse" />
                        </td>
                      </tr>
                    ))
                  ) : (
                    promoCodes.map((code) => (
                      <tr key={code.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                        <td className="py-4 px-4 md:px-6">
                          <code className="bg-gray-100 px-2 py-1 rounded text-sm font-mono font-semibold text-gray-900">
                            {code.code}
                          </code>
                        </td>
                        <td className="py-4 px-4 md:px-6 hidden sm:table-cell">
                          <div className="flex items-center space-x-1">
                            {code.discount_type === 'percentage' ? (
                              <><Percent className="h-4 w-4 text-gray-400" /><span className="font-semibold">{code.discount_value}%</span></>
                            ) : (
                              <><Euro className="h-4 w-4 text-gray-400" /><span className="font-semibold">{code.discount_value}€</span></>
                            )}
                          </div>
                          {code.min_order_amount && (
                            <p className="text-xs text-gray-500">Min : {code.min_order_amount}€</p>
                          )}
                        </td>
                        <td className="py-4 px-4 md:px-6 hidden md:table-cell">
                          <div className="flex items-center space-x-1 text-sm text-gray-600">
                            <Calendar className="h-4 w-4 text-gray-400" />
                            <span>{code.valid_until ? `Jusqu'au ${new Date(code.valid_until).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}` : 'Illimité'}</span>
                          </div>
                        </td>
                        <td className="py-4 px-4 md:px-6 hidden lg:table-cell">
                          <div className="flex items-center space-x-1 text-sm">
                            <Users className="h-4 w-4 text-gray-400" />
                            <span>{code.uses_count}{code.max_uses ? ` / ${code.max_uses}` : ''}</span>
                          </div>
                        </td>
                        <td className="py-4 px-4 md:px-6">{statusBadge(code)}</td>
                        <td className="py-4 px-4 md:px-6">
                          <div className="flex items-center space-x-1">
                            <button
                              onClick={() => handleToggleStatus(code)}
                              className={`p-2 rounded-lg transition-colors ${code.status === 'active' ? 'text-orange-600 hover:bg-orange-50' : 'text-green-600 hover:bg-green-50'}`}
                              title={code.status === 'active' ? 'Désactiver' : 'Activer'}
                            >
                              {code.status === 'active' ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                            </button>
                            <button
                              onClick={() => handleDelete(code)}
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

      {showModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <div className="fixed inset-0 bg-black bg-opacity-25" onClick={closeModal}></div>

            <div className="relative bg-white rounded-xl shadow-xl w-full max-w-lg p-6" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-semibold text-gray-900">Créer un code promo</h3>
                <button onClick={closeModal} className="p-2 text-gray-400 hover:text-gray-600 rounded-lg transition-colors">
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
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Code *</label>
                  <input
                    type="text"
                    value={formData.code}
                    onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent uppercase font-mono"
                    placeholder="BIENVENUE10"
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Type de réduction</label>
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
                    <label className="block text-sm font-medium text-gray-700 mb-1">Valeur *</label>
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

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Montant minimum d'achat (optionnel)</label>
                  <div className="relative">
                    <input
                      type="number"
                      value={formData.min_order_amount ?? ''}
                      onChange={(e) => setFormData({ ...formData, min_order_amount: e.target.value ? parseFloat(e.target.value) : null })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent pr-10"
                      min="0"
                      step="0.01"
                      placeholder="Ex : 500"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">€</span>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Nombre d'utilisations maximum (optionnel)</label>
                  <input
                    type="number"
                    value={formData.max_uses ?? ''}
                    onChange={(e) => setFormData({ ...formData, max_uses: e.target.value ? parseInt(e.target.value, 10) : null })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                    min="1"
                    placeholder="Illimité"
                  />
                  <p className="text-xs text-gray-500 mt-1">Laisser vide = illimité. Un revendeur ne peut utiliser un même code qu'une fois.</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Date d'expiration (optionnel)</label>
                  <input
                    type="datetime-local"
                    value={formData.valid_until ? toDatetimeLocalValue(formData.valid_until) : ''}
                    onChange={(e) => setFormData({ ...formData, valid_until: e.target.value ? new Date(e.target.value).toISOString() : null })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                  />
                  <p className="text-xs text-gray-500 mt-1">Laisser vide = pas d'expiration</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Statut</label>
                  <select
                    value={formData.status}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value as 'active' | 'inactive' })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                  >
                    <option value="active">Actif</option>
                    <option value="inactive">Inactif</option>
                  </select>
                </div>

                <div className="flex justify-end space-x-3 pt-4">
                  <button type="button" onClick={closeModal} className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors">
                    Annuler
                  </button>
                  <button type="submit" disabled={saving} className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50">
                    {saving ? 'Enregistrement...' : 'Créer'}
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
