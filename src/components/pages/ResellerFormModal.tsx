import React, { useEffect, useRef, useState } from 'react';
import { useResellers, Reseller, ResellerFormData, emptyResellerForm } from '../../hooks/useResellers';
import { useGooglePlacesAutocomplete } from '../../hooks/useGooglePlacesAutocomplete';
import { generateSecurePassword } from '../../utils/generatePassword';
import { AlertCircle, X } from 'lucide-react';

interface ResellerFormModalProps {
  isOpen: boolean;
  /** null = création d'un nouveau revendeur, sinon édition de ce revendeur */
  reseller: Reseller | null;
  onClose: () => void;
  /** Appelé après un enregistrement réussi, avec les données sauvegardées. */
  onSaved: (id: string, data: ResellerFormData) => void;
}

/**
 * Formulaire de création/édition d'un revendeur, partagé entre la liste
 * (création) et la vue détail (édition) pour ne pas dupliquer le formulaire.
 */
export const ResellerFormModal: React.FC<ResellerFormModalProps> = ({ isOpen, reseller, onClose, onSaved }) => {
  const { createReseller, updateReseller, fetchContacts, inviteContact, updateContactEmail } = useResellers(false);

  const [formData, setFormData] = useState<ResellerFormData>(emptyResellerForm);
  const [ownerFirstName, setOwnerFirstName] = useState('');
  const [ownerLastName, setOwnerLastName] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [createdOwnerCredentials, setCreatedOwnerCredentials] = useState<{ email: string; password: string } | null>(null);

  const isEditing = Boolean(reseller);

  const addressInputRef = useRef<HTMLInputElement>(null);
  useGooglePlacesAutocomplete(addressInputRef, (place) => {
    setFormData((prev) => ({
      ...prev,
      address: place.address || prev.address,
      city: place.city || prev.city,
      postal_code: place.postal_code || prev.postal_code,
      country: place.country || prev.country,
    }));
  });

  useEffect(() => {
    if (!isOpen) return;
    setFormError(null);
    setCreatedOwnerCredentials(null);
    setOwnerFirstName('');
    setOwnerLastName('');
    setFormData(
      reseller
        ? {
            company_name: reseller.company_name,
            legal_id: reseller.legal_id || '',
            contact_email: reseller.contact_email || '',
            contact_phone: reseller.contact_phone || '',
            notes: reseller.notes || '',
            address: reseller.address || '',
            postal_code: reseller.postal_code || '',
            city: reseller.city || '',
            country: reseller.country || 'France',
          }
        : emptyResellerForm
    );
  }, [isOpen, reseller]);

  const handleClose = () => {
    if (saving) return;
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!formData.company_name.trim()) {
      setFormError("Le nom de l'entreprise est obligatoire");
      return;
    }

    setSaving(true);
    try {
      if (reseller) {
        const result = await updateReseller(reseller.id, formData);
        if (!result.success) {
          setFormError(result.error || 'Une erreur est survenue');
          return;
        }

        // Si l'email principal a changé, on synchronise aussi l'identifiant
        // de connexion réel du contact principal (sinon le champ ne serait
        // qu'informatif et ne changerait rien à la connexion).
        const newEmail = formData.contact_email.trim();
        const previousEmail = (reseller.contact_email || '').trim();
        if (newEmail && newEmail !== previousEmail) {
          const contactsList = await fetchContacts(reseller.id);
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

        onSaved(reseller.id, formData);
        onClose();
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
        const password = generateSecurePassword();
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
          onSaved(result.id, formData);
        } else {
          setFormError(
            `Revendeur créé, mais la création du compte principal a échoué : ${contactResult.error || 'erreur inconnue'}. Réessaie depuis "Gérer les contacts".`
          );
        }
      } else {
        onSaved(result.id, formData);
        onClose();
      }
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="fixed inset-0 bg-black bg-opacity-25" onClick={handleClose}></div>

        <div className="relative bg-white rounded-xl shadow-xl w-full max-w-lg p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-semibold text-gray-900">
              {isEditing ? 'Modifier le revendeur' : 'Nouveau revendeur'}
            </h3>
            <button onClick={handleClose} className="p-2 text-gray-400 hover:text-gray-600 rounded-lg transition-colors">
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
                  onClick={onClose}
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
                    Email principal {isEditing && <span className="text-gray-400 font-normal">(connexion)</span>}
                  </label>
                  <input
                    type="email"
                    value={formData.contact_email}
                    onChange={(e) => setFormData({ ...formData, contact_email: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                  />
                  {isEditing && (
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

              {!isEditing && (
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
                    ref={addressInputRef}
                    type="text"
                    placeholder="Commence à taper une adresse..."
                    value={formData.address}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent text-sm"
                    autoComplete="off"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      placeholder="Code postal"
                      value={formData.postal_code}
                      onChange={(e) => setFormData({ ...formData, postal_code: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent text-sm"
                    />
                    <input
                      type="text"
                      placeholder="Ville"
                      value={formData.city}
                      onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent text-sm"
                    />
                  </div>
                  <select
                    value={formData.country}
                    onChange={(e) => setFormData({ ...formData, country: e.target.value })}
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
                  onClick={handleClose}
                  className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50"
                >
                  {saving ? 'Enregistrement...' : isEditing ? 'Sauvegarder les modifications' : 'Créer'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
