import React, { useEffect, useState } from 'react';
import { Modal } from '../../ui/Modal';
import { AlertCircle } from 'lucide-react';
import { ResellerContact, ContactProfileUpdate, LegalStatus } from '../../../hooks/useResellers';

interface ResellerContactEditModalProps {
  contact: ResellerContact | null;
  onClose: () => void;
  onSave: (profileId: string, profileData: ContactProfileUpdate, newEmail: string | null) => Promise<{ success: boolean; error?: string }>;
}

const LEGAL_STATUS_LABELS: Record<LegalStatus, string> = {
  individual: 'Particulier',
  sole_proprietorship: 'Entreprise Individuelle (EI)',
  company: 'Société',
};

/**
 * Édite les coordonnées d'UN sous-compte précis (contact.profile_id) — pas
 * le revendeur parent. Distincte de ResellerFormModal, qui édite la fiche
 * société (`resellers`), jamais un profil individuel.
 */
export const ResellerContactEditModal: React.FC<ResellerContactEditModalProps> = ({ contact, onClose, onSave }) => {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [country, setCountry] = useState('France');
  const [legalStatus, setLegalStatus] = useState<LegalStatus | ''>('');
  const [legalEntityName, setLegalEntityName] = useState('');
  const [siret, setSiret] = useState('');
  const [vatNumber, setVatNumber] = useState('');
  const [legalForm, setLegalForm] = useState('');
  const [legalAddress, setLegalAddress] = useState('');
  const [legalCity, setLegalCity] = useState('');
  const [legalPostalCode, setLegalPostalCode] = useState('');
  const [legalCountry, setLegalCountry] = useState('France');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (contact) {
      setFirstName(contact.first_name);
      setLastName(contact.last_name);
      setEmail(contact.email);
      setPhone(contact.phone || '');
      setAddress(contact.address || '');
      setCity(contact.city || '');
      setPostalCode(contact.postal_code || '');
      setCountry(contact.country || 'France');
      setLegalStatus(contact.legal_status || '');
      setLegalEntityName(contact.legal_entity_name || '');
      setSiret(contact.siret || '');
      setVatNumber(contact.vat_number || '');
      setLegalForm(contact.legal_form || '');
      setLegalAddress(contact.legal_address || '');
      setLegalCity(contact.legal_city || '');
      setLegalPostalCode(contact.legal_postal_code || '');
      setLegalCountry(contact.legal_country || 'France');
      setError(null);
    }
  }, [contact]);

  const isPro = legalStatus === 'sole_proprietorship' || legalStatus === 'company';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contact) return;
    setSaving(true);
    setError(null);

    const newEmail = email.trim();
    const result = await onSave(
      contact.profile_id,
      {
        first_name: firstName.trim(), last_name: lastName.trim(), phone: phone.trim(),
        address: address.trim(), city: city.trim(), postal_code: postalCode.trim(), country: country.trim(),
        legal_status: legalStatus,
        legal_entity_name: legalEntityName.trim(),
        siret: siret.trim(),
        vat_number: vatNumber.trim(),
        legal_form: legalForm.trim(),
        legal_address: legalAddress.trim(),
        legal_city: legalCity.trim(),
        legal_postal_code: legalPostalCode.trim(),
        legal_country: legalCountry.trim(),
      },
      newEmail !== contact.email ? newEmail : null
    );

    setSaving(false);
    if (!result.success) {
      setError(result.error || 'Erreur lors de la mise à jour');
      return;
    }
    onClose();
  };

  return (
    <Modal isOpen={!!contact} onClose={onClose} title={`Modifier ${contact?.first_name || ''} ${contact?.last_name || ''}`}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Prénom</label>
            <input
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-gray-900 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Nom</label>
            <input
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-gray-900 focus:border-transparent"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-gray-900 focus:border-transparent"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Téléphone</label>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="06 12 34 56 78"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-gray-900 focus:border-transparent"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Adresse de livraison</label>
          <input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-gray-900 focus:border-transparent mb-2"
            placeholder="Adresse"
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              value={postalCode}
              onChange={(e) => setPostalCode(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-gray-900 focus:border-transparent"
              placeholder="Code postal"
            />
            <input
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-gray-900 focus:border-transparent"
              placeholder="Ville"
            />
          </div>
          <select
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            className="w-full mt-2 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-gray-900 focus:border-transparent bg-white"
          >
            <option value="France">France</option>
            <option value="Belgique">Belgique</option>
            <option value="Suisse">Suisse</option>
            <option value="Luxembourg">Luxembourg</option>
            <option value="Monaco">Monaco</option>
          </select>
        </div>

        <div className="pt-2 border-t border-gray-100">
          <p className="text-xs font-medium text-gray-700 mb-2">
            Statut juridique <span className="text-gray-400 font-normal">(indépendant de ce sous-compte, verrouillé côté revendeur une fois choisi)</span>
          </p>
          <select
            value={legalStatus}
            onChange={(e) => setLegalStatus(e.target.value as LegalStatus | '')}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-gray-900 focus:border-transparent bg-white"
          >
            <option value="">Non renseigné</option>
            {(Object.keys(LEGAL_STATUS_LABELS) as LegalStatus[]).map((s) => (
              <option key={s} value={s}>{LEGAL_STATUS_LABELS[s]}</option>
            ))}
          </select>

          {isPro && (
            <div className="mt-2 space-y-2">
              <input
                type="text"
                value={legalEntityName}
                onChange={(e) => setLegalEntityName(e.target.value)}
                placeholder={legalStatus === 'company' ? 'Dénomination sociale' : "Nom officiel de l'EI"}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-gray-900 focus:border-transparent"
              />
              {legalStatus === 'company' && (
                <input
                  type="text"
                  value={legalForm}
                  onChange={(e) => setLegalForm(e.target.value)}
                  placeholder="Forme juridique (SAS, SARL...)"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                />
              )}
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  value={siret}
                  onChange={(e) => setSiret(e.target.value.replace(/\D/g, '').slice(0, 14))}
                  placeholder="SIRET (14 chiffres)"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                />
                <input
                  type="text"
                  value={vatNumber}
                  onChange={(e) => setVatNumber(e.target.value)}
                  placeholder="N° TVA (optionnel)"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                />
              </div>
              <input
                type="text"
                value={legalAddress}
                onChange={(e) => setLegalAddress(e.target.value)}
                placeholder={legalStatus === 'company' ? 'Adresse du siège social' : 'Adresse de facturation pro'}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-gray-900 focus:border-transparent"
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  value={legalPostalCode}
                  onChange={(e) => setLegalPostalCode(e.target.value)}
                  placeholder="Code postal"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                />
                <input
                  type="text"
                  value={legalCity}
                  onChange={(e) => setLegalCity(e.target.value)}
                  placeholder="Ville"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                />
              </div>
              <select
                value={legalCountry}
                onChange={(e) => setLegalCountry(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-gray-900 focus:border-transparent bg-white"
              >
                <option value="France">France</option>
                <option value="Belgique">Belgique</option>
                <option value="Suisse">Suisse</option>
                <option value="Luxembourg">Luxembourg</option>
                <option value="Monaco">Monaco</option>
              </select>
            </div>
          )}
        </div>

        <div className="flex justify-end space-x-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-50 text-sm"
          >
            Annuler
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50 text-sm"
          >
            {saving ? 'Enregistrement...' : 'Enregistrer'}
          </button>
        </div>
      </form>
    </Modal>
  );
};

export default ResellerContactEditModal;
