import React, { useState } from 'react';
import { Card, CardContent } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Modal } from '../ui/Modal';
import { useResellers, Reseller, ResellerFormData, ResellerContact, emptyShippingAddress } from '../../hooks/useResellers';
import { useAdminAuth } from '../../hooks/useAdminAuth';
import { ResellerDetail } from './ResellerDetail';
import {
  Building2,
  Plus,
  Edit,
  Eye,
  Trash2,
  AlertCircle,
  RefreshCw,
  X,
  Pause,
  Play,
  Users,
  UserPlus,
  Search,
  Mail,
} from 'lucide-react';

const generateRandomPassword = (): string => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let result = '';
  for (let i = 0; i < 12; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
};

const emptyForm: ResellerFormData = {
  company_name: '',
  legal_id: '',
  contact_email: '',
  contact_phone: '',
  notes: '',
  shipping_address: emptyShippingAddress,
};

const statusBadge = (status: Reseller['status']) => {
  switch (status) {
    case 'active':
      return <Badge variant="success">Actif</Badge>;
    case 'suspended':
      return <Badge variant="danger">Suspendu</Badge>;
    default:
      return <Badge variant="warning">En attente</Badge>;
  }
};

export const Resellers: React.FC = () => {
  const { isAdmin } = useAdminAuth();
  const {
    resellers,
    loading,
    error,
    refreshResellers,
    createReseller,
    updateReseller,
    updateResellerStatus,
    deleteReseller,
    fetchContacts,
    inviteContact,
    removeContact,
    updateContactEmail,
  } = useResellers(isAdmin);

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | Reseller['status']>('all');
  const [viewingReseller, setViewingReseller] = useState<Reseller | null>(null);

  const [showModal, setShowModal] = useState(false);
  const [editingReseller, setEditingReseller] = useState<Reseller | null>(null);
  const [formData, setFormData] = useState<ResellerFormData>(emptyForm);
  const [ownerFirstName, setOwnerFirstName] = useState('');
  const [ownerLastName, setOwnerLastName] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [createdOwnerCredentials, setCreatedOwnerCredentials] = useState<{ email: string; password: string } | null>(null);

  const [contactsReseller, setContactsReseller] = useState<Reseller | null>(null);
  const [contacts, setContacts] = useState<ResellerContact[]>([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [contactsError, setContactsError] = useState<string | null>(null);
  const [inviteMode, setInviteMode] = useState<'email' | 'password'>('email');
  const [inviteForm, setInviteForm] = useState({ email: '', first_name: '', last_name: '', password: '' });
  const [inviting, setInviting] = useState(false);
  const [createdCredentials, setCreatedCredentials] = useState<{ email: string; password: string } | null>(null);

  const generatePassword = () => {
    setInviteForm((f) => ({ ...f, password: generateRandomPassword() }));
  };

  const filteredResellers = resellers.filter((r) => {
    const matchesSearch =
      r.company_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (r.contact_email || '').toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'all' || r.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const activeCount = resellers.filter((r) => r.status === 'active').length;
  const pendingCount = resellers.filter((r) => r.status === 'pending').length;

  const resetForm = () => {
    setFormData(emptyForm);
    setEditingReseller(null);
    setFormError(null);
    setOwnerFirstName('');
    setOwnerLastName('');
    setCreatedOwnerCredentials(null);
  };

  const openCreateModal = () => {
    resetForm();
    setShowModal(true);
  };

  const openEditModal = (reseller: Reseller) => {
    setEditingReseller(reseller);
    setFormData({
      company_name: reseller.company_name,
      legal_id: reseller.legal_id || '',
      contact_email: reseller.contact_email || '',
      contact_phone: reseller.contact_phone || '',
      notes: reseller.notes || '',
      shipping_address: reseller.shipping_address || emptyShippingAddress,
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

    if (!formData.company_name.trim()) {
      setFormError('Le nom de l\'entreprise est obligatoire');
      return;
    }

    setSaving(true);
    try {
      if (editingReseller) {
        const result = await updateReseller(editingReseller.id, formData);
        if (!result.success) {
          setFormError(result.error || 'Une erreur est survenue');
          return;
        }

        // Si l'email principal a changé, on synchronise aussi l'identifiant
        // de connexion réel du contact principal (sinon le champ ne serait
        // qu'informatif et ne changerait rien à la connexion).
        const newEmail = formData.contact_email.trim();
        const previousEmail = (editingReseller.contact_email || '').trim();
        if (newEmail && newEmail !== previousEmail) {
          const contactsList = await fetchContacts(editingReseller.id);
          const primaryContact = contactsList.find((c) => c.is_primary);
          if (primaryContact) {
            const emailResult = await updateContactEmail(primaryContact.profile_id, newEmail);
            if (!emailResult.success) {
              setFormError(
                `Les informations ont été enregistrées, mais la synchronisation de l'email de connexion a échoué : ${emailResult.error || 'erreur inconnue'}.`
              );
              return;
            }
          }
        }

        closeModal();
        return;
      }

      const result = await createReseller(formData);
      if (!result.success || !result.id) {
        setFormError(result.error || 'Une erreur est survenue');
        return;
      }

      // Si un email de contact est fourni, on crée directement le compte de
      // connexion principal de l'entreprise (mot de passe généré), pour ne
      // pas avoir à repasser par la modale "Gérer les contacts" ensuite.
      if (formData.contact_email.trim()) {
        const password = generateRandomPassword();
        const contactResult = await inviteContact(
          result.id,
          formData.contact_email.trim(),
          ownerFirstName.trim(),
          ownerLastName.trim(),
          password,
          true
        );

        if (contactResult.success) {
          setCreatedOwnerCredentials({ email: formData.contact_email.trim(), password });
        } else {
          setFormError(
            `Revendeur créé, mais la création du compte principal a échoué : ${contactResult.error || 'erreur inconnue'}. Réessaie depuis "Gérer les contacts".`
          );
        }
      } else {
        closeModal();
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (reseller: Reseller) => {
    if (window.confirm(`Supprimer le revendeur "${reseller.company_name}" ? Cette action est irréversible.`)) {
      const result = await deleteReseller(reseller.id);
      if (!result.success) {
        alert(result.error || 'Erreur lors de la suppression');
      }
    }
  };

  const handleToggleStatus = async (reseller: Reseller) => {
    const newStatus = reseller.status === 'active' ? 'suspended' : 'active';
    await updateResellerStatus(reseller.id, newStatus);
  };

  const openContactsModal = async (reseller: Reseller) => {
    setContactsReseller(reseller);
    setInviteForm({ email: '', first_name: '', last_name: '', password: '' });
    setInviteMode('email');
    setCreatedCredentials(null);
    setContactsError(null);
    setContactsLoading(true);
    try {
      const data = await fetchContacts(reseller.id);
      setContacts(data);
    } catch (err) {
      setContactsError(err instanceof Error ? err.message : 'Erreur lors du chargement des contacts');
    } finally {
      setContactsLoading(false);
    }
  };

  const closeContactsModal = () => {
    setContactsReseller(null);
    setContacts([]);
    setContactsError(null);
    setCreatedCredentials(null);
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contactsReseller) return;
    if (!inviteForm.email.trim()) {
      setContactsError('L\'email est obligatoire');
      return;
    }
    if (inviteMode === 'password' && inviteForm.password.trim().length < 8) {
      setContactsError('Le mot de passe doit contenir au moins 8 caractères');
      return;
    }

    setInviting(true);
    setContactsError(null);
    setCreatedCredentials(null);
    try {
      const result = await inviteContact(
        contactsReseller.id,
        inviteForm.email.trim(),
        inviteForm.first_name.trim(),
        inviteForm.last_name.trim(),
        inviteMode === 'password' ? inviteForm.password.trim() : undefined
      );
      if (result.success) {
        if (inviteMode === 'password') {
          setCreatedCredentials({ email: inviteForm.email.trim(), password: inviteForm.password.trim() });
        }
        setInviteForm({ email: '', first_name: '', last_name: '', password: '' });
        const data = await fetchContacts(contactsReseller.id);
        setContacts(data);
        await refreshResellers();
      } else {
        setContactsError(result.error || 'Erreur lors de l\'invitation');
      }
    } finally {
      setInviting(false);
    }
  };

  const handleRemoveContact = async (contact: ResellerContact) => {
    if (!contactsReseller) return;
    if (!window.confirm(`Retirer l'accès de ${contact.first_name} ${contact.last_name} ?`)) return;

    const result = await removeContact(contact.id);
    if (result.success) {
      const data = await fetchContacts(contactsReseller.id);
      setContacts(data);
      await refreshResellers();
    } else {
      setContactsError(result.error || 'Erreur lors de la suppression du contact');
    }
  };

  if (viewingReseller) {
    return <ResellerDetail reseller={viewingReseller} onBack={() => setViewingReseller(null)} />;
  }

  return (
    <div className="p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 gap-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Revendeurs</h3>
          <p className="text-sm text-gray-500">
            {loading ? 'Chargement...' : `${filteredResellers.length} revendeur${filteredResellers.length > 1 ? 's' : ''}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 px-3 py-1 bg-green-50 rounded-lg">
            <span className="text-sm font-medium text-green-700">{activeCount} actif{activeCount > 1 ? 's' : ''}</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-1 bg-yellow-50 rounded-lg">
            <span className="text-sm font-medium text-yellow-700">{pendingCount} en attente</span>
          </div>
          <button
            onClick={refreshResellers}
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
            <span>Nouveau revendeur</span>
          </button>
        </div>
      </div>

      {/* Filtres */}
      <div className="flex flex-col md:flex-row gap-4 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder="Rechercher par entreprise ou email..."
            className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:border-gray-400 focus:outline-none"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <select
          className="px-4 py-2 border border-gray-200 rounded-lg focus:border-gray-400 focus:outline-none"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
        >
          <option value="all">Tous les statuts</option>
          <option value="pending">En attente</option>
          <option value="active">Actif</option>
          <option value="suspended">Suspendu</option>
        </select>
      </div>

      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 flex items-center space-x-3">
          <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0" />
          <p className="text-sm text-red-700">Erreur : {error}</p>
        </div>
      )}

      {!loading && !error && filteredResellers.length === 0 && (
        <div className="text-center py-12">
          <Building2 className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">Aucun revendeur</h3>
          <p className="text-gray-500 mb-6">Ajoutez votre premier revendeur externe</p>
          <button
            onClick={openCreateModal}
            className="inline-flex items-center space-x-2 px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors"
          >
            <Plus className="h-4 w-4" />
            <span>Créer un revendeur</span>
          </button>
        </div>
      )}

      {(filteredResellers.length > 0 || loading) && (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left py-3 px-4 md:px-6 font-medium text-gray-900 text-sm">Entreprise</th>
                    <th className="text-left py-3 px-4 md:px-6 font-medium text-gray-900 text-sm hidden sm:table-cell">Statut</th>
                    <th className="text-left py-3 px-4 md:px-6 font-medium text-gray-900 text-sm hidden lg:table-cell">Contacts</th>
                    <th className="text-left py-3 px-4 md:px-6 font-medium text-gray-900 text-sm">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    [...Array(3)].map((_, index) => (
                      <tr key={`skeleton-${index}`} className="border-b border-gray-50">
                        <td className="py-4 px-4 md:px-6">
                          <div className="h-4 w-32 bg-gray-200 rounded animate-pulse" />
                        </td>
                        <td className="py-4 px-4 md:px-6 hidden sm:table-cell">
                          <div className="h-6 w-16 bg-gray-200 rounded animate-pulse" />
                        </td>
                        <td className="py-4 px-4 md:px-6 hidden lg:table-cell">
                          <div className="h-4 w-8 bg-gray-200 rounded animate-pulse" />
                        </td>
                        <td className="py-4 px-4 md:px-6">
                          <div className="h-6 w-20 bg-gray-200 rounded animate-pulse" />
                        </td>
                      </tr>
                    ))
                  ) : (
                    filteredResellers.map((reseller) => (
                      <tr key={reseller.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                        <td className="py-4 px-4 md:px-6">
                          <div className="flex items-center space-x-3">
                            <div className="h-9 w-9 rounded-full bg-gray-900 flex items-center justify-center flex-shrink-0">
                              <Building2 className="h-4 w-4 text-white" />
                            </div>
                            <div>
                              <p className="font-medium text-gray-900 text-sm md:text-base">{reseller.company_name}</p>
                              {reseller.contact_email && (
                                <p className="text-xs md:text-sm text-gray-500 flex items-center gap-1">
                                  <Mail className="h-3 w-3" /> {reseller.contact_email}
                                </p>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="py-4 px-4 md:px-6 hidden sm:table-cell">{statusBadge(reseller.status)}</td>
                        <td className="py-4 px-4 md:px-6 hidden lg:table-cell">
                          <div className="flex items-center gap-1 text-sm text-gray-600">
                            <Users className="h-4 w-4 text-gray-400" />
                            {reseller.contacts_count}
                          </div>
                        </td>
                        <td className="py-4 px-4 md:px-6">
                          <div className="flex items-center space-x-1">
                            <button
                              onClick={() => setViewingReseller(reseller)}
                              className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                              title="Détails"
                            >
                              <Eye className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => openContactsModal(reseller)}
                              className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                              title="Gérer les contacts"
                            >
                              <UserPlus className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => handleToggleStatus(reseller)}
                              className={`p-2 rounded-lg transition-colors ${
                                reseller.status === 'active'
                                  ? 'text-orange-600 hover:bg-orange-50'
                                  : 'text-green-600 hover:bg-green-50'
                              }`}
                              title={reseller.status === 'active' ? 'Suspendre' : 'Activer'}
                            >
                              {reseller.status === 'active' ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                            </button>
                            <button
                              onClick={() => openEditModal(reseller)}
                              className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                              title="Modifier"
                            >
                              <Edit className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => handleDelete(reseller)}
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
                  {editingReseller ? 'Modifier le revendeur' : 'Nouveau revendeur'}
                </h3>
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

              {createdOwnerCredentials ? (
                <div className="space-y-4">
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4 space-y-2">
                    <p className="text-sm font-medium text-green-800">
                      Revendeur créé, avec un compte principal prêt à l'emploi. Communique ces identifiants à l'administrateur de l'entreprise (ils ne seront plus affichés) :
                    </p>
                    <div className="bg-white rounded-lg border border-green-200 p-3 space-y-1">
                      <p className="text-xs text-gray-500">Email</p>
                      <p className="text-sm font-mono text-gray-900">{createdOwnerCredentials.email}</p>
                      <p className="text-xs text-gray-500 mt-1">Mot de passe</p>
                      <p className="text-sm font-mono text-gray-900">{createdOwnerCredentials.password}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        navigator.clipboard.writeText(
                          `Email : ${createdOwnerCredentials.email}\nMot de passe : ${createdOwnerCredentials.password}`
                        )
                      }
                      className="text-xs text-green-700 underline"
                    >
                      Copier
                    </button>
                    <p className="text-xs text-gray-500 pt-1">
                      Ce contact est le compte "principal" de l'entreprise : il pourra lui-même créer des accès pour ses collègues depuis son espace.
                    </p>
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={closeModal}
                      className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors"
                    >
                      Fermer
                    </button>
                  </div>
                </div>
              ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Nom de l'entreprise *</label>
                  <input
                    type="text"
                    value={formData.company_name}
                    onChange={(e) => setFormData({ ...formData, company_name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                    placeholder="Ex: Maison Dubois SARL"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">SIRET / TVA</label>
                  <input
                    type="text"
                    value={formData.legal_id}
                    onChange={(e) => setFormData({ ...formData, legal_id: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Email principal {editingReseller && <span className="text-gray-400 font-normal">(connexion)</span>}
                    </label>
                    <input
                      type="email"
                      value={formData.contact_email}
                      onChange={(e) => setFormData({ ...formData, contact_email: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                    />
                    {editingReseller && (
                      <p className="text-xs text-gray-500 mt-1">Modifier cet email met aussi à jour l'identifiant de connexion du contact principal.</p>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Téléphone</label>
                    <input
                      type="tel"
                      value={formData.contact_phone}
                      onChange={(e) => setFormData({ ...formData, contact_phone: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                    />
                  </div>
                </div>

                {!editingReseller && (
                  <div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Prénom du contact principal</label>
                        <input
                          type="text"
                          value={ownerFirstName}
                          onChange={(e) => setOwnerFirstName(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Nom du contact principal</label>
                        <input
                          type="text"
                          value={ownerLastName}
                          onChange={(e) => setOwnerLastName(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                        />
                      </div>
                    </div>
                    {formData.contact_email.trim() && (
                      <p className="text-xs text-gray-500 mt-2">
                        Un compte de connexion sera créé automatiquement pour cet email, avec un mot de passe généré à te communiquer toi-même à l'administrateur de l'entreprise. Il pourra ensuite créer des accès pour ses collègues.
                      </p>
                    )}
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Adresse de livraison</label>
                  <div className="space-y-2">
                    <input
                      type="text"
                      placeholder="Adresse"
                      value={formData.shipping_address.line1}
                      onChange={(e) => setFormData({ ...formData, shipping_address: { ...formData.shipping_address, line1: e.target.value } })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent text-sm"
                    />
                    <input
                      type="text"
                      placeholder="Complément d'adresse"
                      value={formData.shipping_address.line2}
                      onChange={(e) => setFormData({ ...formData, shipping_address: { ...formData.shipping_address, line2: e.target.value } })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent text-sm"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="text"
                        placeholder="Code postal"
                        value={formData.shipping_address.postal_code}
                        onChange={(e) => setFormData({ ...formData, shipping_address: { ...formData.shipping_address, postal_code: e.target.value } })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent text-sm"
                      />
                      <input
                        type="text"
                        placeholder="Ville"
                        value={formData.shipping_address.city}
                        onChange={(e) => setFormData({ ...formData, shipping_address: { ...formData.shipping_address, city: e.target.value } })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent text-sm"
                      />
                    </div>
                    <select
                      value={formData.shipping_address.country}
                      onChange={(e) => setFormData({ ...formData, shipping_address: { ...formData.shipping_address, country: e.target.value } })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent text-sm bg-white"
                    >
                      <option value="France">France</option>
                      <option value="Belgique">Belgique</option>
                      <option value="Suisse">Suisse</option>
                      <option value="Luxembourg">Luxembourg</option>
                      <option value="Monaco">Monaco</option>
                      <option value="Allemagne">Allemagne</option>
                      <option value="Italie">Italie</option>
                      <option value="Espagne">Espagne</option>
                      <option value="Royaume-Uni">Royaume-Uni</option>
                      <option value="Autre">Autre</option>
                    </select>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">Utilisée pour toutes les commandes de cette entreprise (contact principal et sous-comptes).</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Notes internes</label>
                  <textarea
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                    rows={3}
                    placeholder="Jamais visibles par le revendeur"
                  />
                </div>

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
                    {saving ? 'Enregistrement...' : editingReseller ? 'Sauvegarder les modifications' : 'Créer'}
                  </button>
                </div>
              </form>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal Contacts */}
      <Modal
        isOpen={!!contactsReseller}
        onClose={closeContactsModal}
        title={contactsReseller ? `Contacts — ${contactsReseller.company_name}` : 'Contacts'}
      >
        <div className="space-y-4">
          {contactsError && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-center space-x-2">
              <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0" />
              <p className="text-sm text-red-700">{contactsError}</p>
            </div>
          )}

          {contactsLoading ? (
            <div className="space-y-2">
              {[...Array(2)].map((_, i) => (
                <div key={i} className="h-10 bg-gray-100 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : contacts.length === 0 ? (
            <p className="text-sm text-gray-500">Aucun contact pour ce revendeur pour l'instant.</p>
          ) : (
            <ul className="space-y-2">
              {contacts.map((c) => (
                <li key={c.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{c.first_name} {c.last_name}</p>
                    <p className="text-xs text-gray-500">{c.email}</p>
                  </div>
                  <button
                    onClick={() => handleRemoveContact(c)}
                    className="p-1 text-gray-400 hover:text-red-600 transition-colors"
                    title="Retirer l'accès"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {createdCredentials && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 space-y-2">
              <p className="text-sm font-medium text-green-800">Compte créé — communique ces identifiants au revendeur (ils ne seront plus affichés) :</p>
              <div className="bg-white rounded-lg border border-green-200 p-2 space-y-1">
                <p className="text-xs text-gray-500">Email</p>
                <p className="text-sm font-mono text-gray-900">{createdCredentials.email}</p>
                <p className="text-xs text-gray-500 mt-1">Mot de passe</p>
                <p className="text-sm font-mono text-gray-900">{createdCredentials.password}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(`Email : ${createdCredentials.email}\nMot de passe : ${createdCredentials.password}`);
                }}
                className="text-xs text-green-700 underline"
              >
                Copier
              </button>
            </div>
          )}

          <form onSubmit={handleInvite} className="space-y-3 pt-3 border-t border-gray-100">
            <p className="text-sm font-medium text-gray-700">Ajouter un nouveau contact</p>

            <div className="flex rounded-lg border border-gray-200 p-1 text-sm">
              <button
                type="button"
                onClick={() => setInviteMode('email')}
                className={`flex-1 py-1.5 rounded-md transition-colors ${inviteMode === 'email' ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
              >
                Inviter par email
              </button>
              <button
                type="button"
                onClick={() => setInviteMode('password')}
                className={`flex-1 py-1.5 rounded-md transition-colors ${inviteMode === 'password' ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
              >
                Créer avec mot de passe
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <input
                type="text"
                placeholder="Prénom"
                value={inviteForm.first_name}
                onChange={(e) => setInviteForm({ ...inviteForm, first_name: e.target.value })}
                className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent text-sm"
              />
              <input
                type="text"
                placeholder="Nom"
                value={inviteForm.last_name}
                onChange={(e) => setInviteForm({ ...inviteForm, last_name: e.target.value })}
                className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent text-sm"
              />
            </div>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="email"
                placeholder="email@entreprise.com"
                value={inviteForm.email}
                onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
                className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent text-sm"
                required
              />
            </div>

            {inviteMode === 'password' && (
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Mot de passe (min. 8 caractères)"
                  value={inviteForm.password}
                  onChange={(e) => setInviteForm({ ...inviteForm, password: e.target.value })}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent text-sm font-mono"
                />
                <button
                  type="button"
                  onClick={generatePassword}
                  className="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-xs whitespace-nowrap"
                >
                  Générer
                </button>
              </div>
            )}

            {inviteMode === 'password' && (
              <p className="text-xs text-gray-500">Aucun email n'est envoyé dans ce mode — communique ces identifiants toi-même au revendeur.</p>
            )}

            <button
              type="submit"
              disabled={inviting}
              className="w-full flex items-center justify-center space-x-2 px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50 text-sm"
            >
              <UserPlus className="h-4 w-4" />
              <span>{inviting ? 'Création...' : inviteMode === 'password' ? 'Créer le compte' : "Envoyer l'invitation"}</span>
            </button>
          </form>
        </div>
      </Modal>
    </div>
  );
};
