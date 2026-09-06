import React, { useState, useEffect, useRef } from 'react';
import { Card, CardContent } from '../../ui/Card';
import { useResellerAuth, ResellerProfile as ResellerProfileType, LegalInfoInput } from '../../../hooks/useResellerAuth';
import { useGooglePlacesAutocomplete } from '../../../hooks/useGooglePlacesAutocomplete';
import { supabase } from '../../../lib/supabase';
import { openServicePointPicker } from '../../../services/sendcloudService';
import { ChronopostPickupPoint } from '../../../services/chronopostService';
import { Building2, CheckCircle2, AlertCircle, Lock, Eye, EyeOff, Check, Circle, Truck, Package, MapPin, Scale } from 'lucide-react';
import { isPlausiblePhone } from '../../../utils/phoneValidation';

export const ResellerProfile: React.FC = () => {
  const { profile, updateLegalInfo } = useResellerAuth();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [country, setCountry] = useState('France');
  const [deliveryInstructions, setDeliveryInstructions] = useState('');
  const [defaultRelayPoint, setDefaultRelayPoint] = useState<ChronopostPickupPoint | null>(null);
  const [defaultDeliveryType, setDefaultDeliveryType] = useState<'domicile' | 'point_relais' | null>(null);
  const [relayPickerLoading, setRelayPickerLoading] = useState(false);
  const [relayPickerError, setRelayPickerError] = useState('');
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addressInputRef = useRef<HTMLInputElement>(null);
  useGooglePlacesAutocomplete(addressInputRef, (place) => {
    setAddress(place.address || address);
    setCity(place.city || city);
    setPostalCode(place.postal_code || postalCode);
    setCountry(place.country || country);
  });

  useEffect(() => {
    if (profile) {
      setFirstName(profile.first_name);
      setLastName(profile.last_name);
      setPhone(profile.phone || '');
      setAddress(profile.address || '');
      setCity(profile.city || '');
      setPostalCode(profile.postal_code || '');
      setCountry(profile.country || 'France');
      setDeliveryInstructions(profile.delivery_instructions || '');
      setDefaultRelayPoint((profile.default_relay_point as unknown as ChronopostPickupPoint) || null);
      setDefaultDeliveryType(profile.default_delivery_type);
    }
  }, [profile]);

  const hasAddressForm = Boolean(address.trim() && city.trim() && postalCode.trim());

  const openRelayPicker = async () => {
    setRelayPickerError('');
    setRelayPickerLoading(true);
    try {
      const point = await openServicePointPicker({
        postalCode: postalCode || '75001',
        city: city || 'Paris',
        country,
      });
      if (point) {
        setDefaultRelayPoint(point);
      }
    } catch (err) {
      setRelayPickerError(err instanceof Error ? err.message : "Impossible d'ouvrir la carte des points relais");
    } finally {
      setRelayPickerLoading(false);
    }
  };

  const removeRelayPoint = () => {
    setDefaultRelayPoint(null);
    if (defaultDeliveryType === 'point_relais') {
      setDefaultDeliveryType(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;

    if (phone.trim() && !isPlausiblePhone(phone)) {
      setError('Le numéro de téléphone renseigné ne semble pas valide.');
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(false);

    // Prénom/nom/email restent verrouillés côté UI (gérés par un admin OZË) —
    // seul le téléphone est désormais modifiable ici en plus des préférences
    // de livraison : Sendcloud (Mondial Relay en particulier) exige un
    // téléphone valide pour générer un bordereau, et ce champ était jusqu'ici
    // bloqué sans aucun moyen de le renseigner soi-même.
    const { error: updateError } = await supabase
      .from('profiles')
      .update({
        phone: phone.trim() || null,
        address: address.trim() || null,
        city: city.trim() || null,
        postal_code: postalCode.trim() || null,
        country: country.trim() || null,
        delivery_instructions: deliveryInstructions.trim() || null,
        default_relay_point: defaultRelayPoint,
        default_delivery_type: defaultDeliveryType,
      })
      .eq('id', profile.id);

    setSaving(false);
    if (updateError) {
      setError(updateError.message);
    } else {
      setSuccess(true);
    }
  };

  if (!profile) return null;

  return (
    <div className="max-w-6xl mx-auto w-full px-4 py-8">
      <h3 className="text-lg font-semibold text-gray-900 mb-6">Mon profil</h3>

      <Card className="mb-6">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm text-gray-700">
            <Building2 className="h-4 w-4 text-gray-400" />
            <span className="font-medium">{profile.company_name}</span>
          </div>
        </CardContent>
      </Card>

      <LegalStatusSection profile={profile} updateLegalInfo={updateLegalInfo} />

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-3 flex items-center space-x-2">
          <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {success && (
        <div className="mb-4 bg-green-50 border border-green-200 rounded-lg p-3 flex items-center space-x-2">
          <CheckCircle2 className="h-4 w-4 text-green-600 flex-shrink-0" />
          <p className="text-sm text-green-700">Profil mis à jour</p>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <Card>
            <CardContent className="p-5 space-y-4">
              <h4 className="text-sm font-semibold text-gray-900">Informations personnelles</h4>

              <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 flex items-start gap-2">
                <p className="text-xs text-blue-800">
                  💡 Pour modifier vos informations personnelles d'entreprise, veuillez contacter directement votre
                  administrateur OZË Paris.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Prénom</label>
                  <input
                    type="text"
                    value={firstName}
                    readOnly
                    disabled
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg bg-gray-100 text-gray-500 cursor-not-allowed"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Nom</label>
                  <input
                    type="text"
                    value={lastName}
                    readOnly
                    disabled
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg bg-gray-100 text-gray-500 cursor-not-allowed"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input
                  type="email"
                  value={profile.email}
                  readOnly
                  disabled
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg bg-gray-100 text-gray-500 cursor-not-allowed"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Téléphone</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent text-sm"
                  placeholder="06 12 34 56 78"
                />
                <p className="text-xs text-gray-500 mt-1">Requis par le transporteur pour générer une étiquette de livraison.</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5 space-y-4">
              <div>
                <h4 className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
                  <Truck className="h-4 w-4 text-gray-400" />
                  Préférences de livraison
                </h4>
                <p className="text-xs text-gray-500 mt-1">
                  Enregistrées ici, elles sont présélectionnées automatiquement au moment de payer — vous pouvez
                  toujours en changer pour une commande précise.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Adresse</label>
                <div className="space-y-2">
                  <input
                    ref={addressInputRef}
                    type="text"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    autoComplete="off"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent text-sm"
                    placeholder="Commencez à taper votre adresse..."
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={postalCode}
                      onChange={(e) => setPostalCode(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent text-sm"
                      placeholder="Code postal"
                    />
                    <input
                      type="text"
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent text-sm"
                      placeholder="Ville"
                    />
                  </div>
                  <select
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent text-sm bg-white"
                  >
                    <option value="France">France</option>
                    <option value="Belgique">Belgique</option>
                    <option value="Suisse">Suisse</option>
                    <option value="Luxembourg">Luxembourg</option>
                    <option value="Monaco">Monaco</option>
                  </select>
                </div>
                <p className="text-xs text-gray-500 mt-1">Utilisée pour préremplir "Livrer à mon entreprise" au moment de la commande.</p>

                <label className="mt-2 flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={defaultDeliveryType === 'domicile'}
                    disabled={!hasAddressForm}
                    onChange={(e) => setDefaultDeliveryType(e.target.checked ? 'domicile' : null)}
                    className="mt-0.5 h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-400 flex-shrink-0 disabled:opacity-40"
                  />
                  <span className="text-sm text-gray-600">
                    Définir comme mode de livraison par défaut pour mes commandes rapides
                  </span>
                </label>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Instructions de livraison</label>
                <textarea
                  value={deliveryInstructions}
                  onChange={(e) => setDeliveryInstructions(e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent text-sm"
                  placeholder="Étage, digicode, consignes pour le livreur..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Point Relais favori</label>
                {defaultRelayPoint ? (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-3 flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2 min-w-0">
                      <Package className="h-4 w-4 text-green-600 flex-shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-green-800 truncate">{defaultRelayPoint.name}</p>
                        <p className="text-xs text-green-700">
                          {defaultRelayPoint.address && `${defaultRelayPoint.address}, `}
                          {defaultRelayPoint.zipCode} {defaultRelayPoint.city}
                        </p>
                        <p className="text-xs text-green-600 mt-0.5">{defaultRelayPoint.network}</p>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      <button
                        type="button"
                        onClick={openRelayPicker}
                        disabled={relayPickerLoading}
                        className="text-xs text-gray-900 underline hover:text-gray-600 disabled:opacity-50"
                      >
                        Changer
                      </button>
                      <button
                        type="button"
                        onClick={removeRelayPoint}
                        className="text-xs text-red-600 underline hover:text-red-800"
                      >
                        Supprimer
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={openRelayPicker}
                    disabled={relayPickerLoading}
                    className="w-full py-2 px-4 border-2 border-dashed border-gray-300 rounded-lg text-sm text-gray-600 hover:border-gray-900 hover:text-gray-900 transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
                  >
                    <MapPin className="h-4 w-4" />
                    {relayPickerLoading ? 'Ouverture de la carte…' : 'Choisir un point relais'}
                  </button>
                )}
                {relayPickerError && (
                  <p className="text-xs text-red-600 mt-1 flex items-center gap-1">
                    <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                    {relayPickerError}
                  </p>
                )}

                <label className="mt-2 flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={defaultDeliveryType === 'point_relais'}
                    disabled={!defaultRelayPoint}
                    onChange={(e) => setDefaultDeliveryType(e.target.checked ? 'point_relais' : null)}
                    className="mt-0.5 h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-400 flex-shrink-0 disabled:opacity-40"
                  />
                  <span className="text-sm text-gray-600">
                    Définir comme mode de livraison par défaut pour mes commandes rapides
                  </span>
                </label>
              </div>
            </CardContent>
          </Card>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="mt-6 px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50 text-sm"
        >
          {saving ? 'Enregistrement...' : 'Enregistrer'}
        </button>
      </form>

      <SecuritySection email={profile.email} />
    </div>
  );
};

// ---------------------------------------------------------------------------
// Statut juridique — Particulier / Entreprise Individuelle / Société (0109).
// Conditionne le droit de rétractation applicable et les mentions légales
// des factures ; bloque commande et enchère tant qu'il n'est pas renseigné
// (voir CartPage.tsx / Auctions.tsx).
// ---------------------------------------------------------------------------

type LegalStatus = 'individual' | 'sole_proprietorship' | 'company';

const LEGAL_STATUS_OPTIONS: { value: LegalStatus; label: string; description: string }[] = [
  { value: 'individual', label: 'Particulier', description: 'Achat à titre personnel' },
  { value: 'sole_proprietorship', label: 'Entreprise Individuelle (EI)', description: 'Auto-entrepreneur / EI' },
  { value: 'company', label: 'Société', description: 'SAS, SASU, SARL, etc.' },
];

const LEGAL_FORMS = ['SAS', 'SASU', 'SARL', 'EURL', 'SA', 'SNC', 'SCI', 'Autre'];
const SIRET_REGEX = /^[0-9]{14}$/;

interface LegalStatusSectionProps {
  profile: ResellerProfileType;
  updateLegalInfo: (input: LegalInfoInput) => Promise<{ success: boolean; error?: string }>;
}

const LegalStatusSection: React.FC<LegalStatusSectionProps> = ({ profile, updateLegalInfo }) => {
  const [legalStatus, setLegalStatus] = useState<LegalStatus | null>(profile.legal_status);
  const [legalEntityName, setLegalEntityName] = useState(profile.legal_entity_name || '');
  const [siret, setSiret] = useState(profile.siret || '');
  const [vatNumber, setVatNumber] = useState(profile.vat_number || '');
  const [legalForm, setLegalForm] = useState(profile.legal_form || '');
  const [address, setAddress] = useState(profile.legal_address || '');
  const [city, setCity] = useState(profile.legal_city || '');
  const [postalCode, setPostalCode] = useState(profile.legal_postal_code || '');
  const [country, setCountry] = useState(profile.legal_country || 'France');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    setLegalStatus(profile.legal_status);
    setLegalEntityName(profile.legal_entity_name || '');
    setSiret(profile.siret || '');
    setVatNumber(profile.vat_number || '');
    setLegalForm(profile.legal_form || '');
    setAddress(profile.legal_address || '');
    setCity(profile.legal_city || '');
    setPostalCode(profile.legal_postal_code || '');
    setCountry(profile.legal_country || 'France');
  }, [profile]);

  const isPro = legalStatus === 'sole_proprietorship' || legalStatus === 'company';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (!legalStatus) {
      setError('Veuillez sélectionner un statut');
      return;
    }
    if (isPro) {
      if (!legalEntityName.trim()) {
        setError('La dénomination est obligatoire pour ce statut');
        return;
      }
      if (!SIRET_REGEX.test(siret.trim())) {
        setError('Le numéro SIRET doit comporter exactement 14 chiffres');
        return;
      }
      if (legalStatus === 'company' && !legalForm) {
        setError('La forme juridique est obligatoire pour une société');
        return;
      }
    }

    setSaving(true);
    const result = await updateLegalInfo({ legalStatus, legalEntityName, siret, vatNumber, legalForm, address, city, postalCode, country });
    setSaving(false);

    if (!result.success) {
      setError(result.error || 'Une erreur est survenue');
      return;
    }
    setSuccess(true);
  };

  return (
    <Card className="mb-6">
      <CardContent className="p-5 space-y-4">
        <div>
          <h4 className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
            <Scale className="h-4 w-4 text-gray-400" />
            Statut juridique
          </h4>
          <p className="text-xs text-gray-500 mt-1">
            Obligatoire : conditionne le droit de rétractation applicable et les mentions légales de vos factures.
          </p>
        </div>

        {profile.legal_status ? (
          <div className="space-y-3">
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-1.5">
              <p className="text-sm font-medium text-gray-900">
                {LEGAL_STATUS_OPTIONS.find((o) => o.value === profile.legal_status)?.label}
              </p>
              {profile.legal_status === 'individual' ? (
                <p className="text-xs text-gray-600">
                  Bénéficie du droit légal de rétractation de 14 jours sur les ventes à distance applicables.
                </p>
              ) : (
                <div className="text-xs text-gray-600 space-y-0.5">
                  <p>
                    {profile.legal_status === 'company' ? 'Dénomination sociale' : "Nom officiel de l'EI"} :{' '}
                    <span className="text-gray-900">{profile.legal_entity_name}</span>
                  </p>
                  {profile.legal_form && (
                    <p>Forme juridique : <span className="text-gray-900">{profile.legal_form}</span></p>
                  )}
                  {profile.siret && <p>SIRET : <span className="text-gray-900 font-mono">{profile.siret}</span></p>}
                  {profile.vat_number && <p>N° TVA : <span className="text-gray-900 font-mono">{profile.vat_number}</span></p>}
                  {profile.legal_address && (
                    <p>
                      Adresse :{' '}
                      <span className="text-gray-900">
                        {profile.legal_address}, {profile.legal_postal_code} {profile.legal_city}, {profile.legal_country}
                      </span>
                    </p>
                  )}
                </div>
              )}
            </div>
            <p className="text-xs text-gray-500">
              💡 Ce statut est désormais définitif et ne peut plus être modifié ici. Pour le corriger, contactez directement votre administrateur OZË Paris.
            </p>
          </div>
        ) : (
          <>
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-amber-800">
                Ce statut est obligatoire pour passer commande, et ne pourra plus être modifié une fois enregistré — choisissez-le avec soin.
              </p>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-center space-x-2">
                <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0" />
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}
            {success && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-3 flex items-center space-x-2">
                <CheckCircle2 className="h-4 w-4 text-green-600 flex-shrink-0" />
                <p className="text-sm text-green-700">Statut juridique enregistré</p>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {LEGAL_STATUS_OPTIONS.map((opt) => (
              <button
                type="button"
                key={opt.value}
                onClick={() => setLegalStatus(opt.value)}
                className={`text-left px-3 py-2.5 rounded-lg border-2 transition-colors ${
                  legalStatus === opt.value ? 'border-gray-900 bg-gray-50' : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <p className="text-sm font-medium text-gray-900">{opt.label}</p>
                <p className="text-xs text-gray-500 mt-0.5">{opt.description}</p>
              </button>
            ))}
          </div>

          {legalStatus === 'individual' && (
            <p className="text-xs text-blue-800 bg-blue-50 border border-blue-100 rounded-lg p-3">
              Statut particulier : bénéficie du droit légal de rétractation de 14 jours sur les ventes à distance applicables.
            </p>
          )}

          {isPro && (
            <div className="space-y-3 pt-1">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {legalStatus === 'sole_proprietorship' ? "Nom officiel de l'EI" : 'Dénomination sociale'}
                </label>
                <input
                  type="text"
                  value={legalEntityName}
                  onChange={(e) => setLegalEntityName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent text-sm"
                  placeholder={legalStatus === 'sole_proprietorship' ? 'Ex: Jean Dupont EI' : 'Ex: Maison Dubois SARL'}
                />
              </div>

              {legalStatus === 'company' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Forme juridique</label>
                  <select
                    value={legalForm}
                    onChange={(e) => setLegalForm(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent text-sm bg-white"
                  >
                    <option value="">Sélectionner...</option>
                    {LEGAL_FORMS.map((f) => (
                      <option key={f} value={f}>{f}</option>
                    ))}
                  </select>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">SIRET</label>
                  <input
                    type="text"
                    value={siret}
                    onChange={(e) => setSiret(e.target.value.replace(/\D/g, '').slice(0, 14))}
                    inputMode="numeric"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent text-sm font-mono"
                    placeholder="14 chiffres"
                  />
                  {siret && !SIRET_REGEX.test(siret) && <p className="text-xs text-red-600 mt-1">{siret.length}/14 chiffres</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    N° TVA intracommunautaire <span className="text-gray-400 font-normal">(optionnel)</span>
                  </label>
                  <input
                    type="text"
                    value={vatNumber}
                    onChange={(e) => setVatNumber(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent text-sm font-mono"
                    placeholder="FR12345678901"
                  />
                  <p className="text-xs text-gray-500 mt-1">Laisser vide en cas de franchise en base de TVA.</p>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {legalStatus === 'company' ? 'Adresse du siège social' : 'Adresse de facturation professionnelle'}
                </label>
                <div className="space-y-2">
                  <input
                    type="text"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent text-sm"
                    placeholder="Numéro et rue"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={postalCode}
                      onChange={(e) => setPostalCode(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent text-sm"
                      placeholder="Code postal"
                    />
                    <input
                      type="text"
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent text-sm"
                      placeholder="Ville"
                    />
                  </div>
                  <select
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent text-sm bg-white"
                  >
                    <option value="France">France</option>
                    <option value="Belgique">Belgique</option>
                    <option value="Suisse">Suisse</option>
                    <option value="Luxembourg">Luxembourg</option>
                    <option value="Monaco">Monaco</option>
                  </select>
                </div>
              </div>
            </div>
          )}

              <button
                type="submit"
                disabled={saving || !legalStatus}
                className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50 text-sm"
              >
                {saving ? 'Enregistrement...' : 'Enregistrer le statut juridique'}
              </button>
            </form>
          </>
        )}
      </CardContent>
    </Card>
  );
};

// ---------------------------------------------------------------------------
// Sécurité — changement de mot de passe
// ---------------------------------------------------------------------------

const PASSWORD_REQUIREMENTS: { label: string; test: (password: string) => boolean }[] = [
  { label: 'Au moins 8 caractères', test: (p) => p.length >= 8 },
  { label: 'Une majuscule', test: (p) => /[A-Z]/.test(p) },
  { label: 'Une minuscule', test: (p) => /[a-z]/.test(p) },
  { label: 'Un chiffre', test: (p) => /[0-9]/.test(p) },
];

const isPasswordStrongEnough = (password: string): boolean => PASSWORD_REQUIREMENTS.every((r) => r.test(password));

interface SecuritySectionProps {
  email: string;
}

const SecuritySection: React.FC<SecuritySectionProps> = ({ email }) => {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const passwordsMatch = confirmPassword.length > 0 && newPassword === confirmPassword;
  const newPasswordValid = isPasswordStrongEnough(newPassword);
  const canSubmit =
    currentPassword.length > 0 && newPasswordValid && passwordsMatch && newPassword !== currentPassword;

  const resetForm = () => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (!currentPassword) {
      setError('Veuillez renseigner votre mot de passe actuel');
      return;
    }
    if (!newPasswordValid) {
      setError('Le nouveau mot de passe ne respecte pas les critères ci-dessous');
      return;
    }
    if (!passwordsMatch) {
      setError('Les deux mots de passe ne correspondent pas');
      return;
    }
    if (newPassword === currentPassword) {
      setError("Le nouveau mot de passe doit être différent de l'actuel");
      return;
    }

    setSubmitting(true);

    // Supabase n'expose pas de vérification de mot de passe isolée côté
    // client : on ré-authentifie avec l'email + le mot de passe actuel pour
    // le confirmer avant d'appliquer le changement.
    const { error: verifyError } = await supabase.auth.signInWithPassword({
      email,
      password: currentPassword,
    });

    if (verifyError) {
      setSubmitting(false);
      setError('Mot de passe actuel incorrect');
      return;
    }

    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });

    setSubmitting(false);

    if (updateError) {
      setError("Impossible de mettre à jour le mot de passe : " + updateError.message);
      return;
    }

    setSuccess(true);
    resetForm();
  };

  return (
    <div className="mt-8 pt-8 border-t border-gray-200">
      <h3 className="text-lg font-semibold text-gray-900 mb-1">Sécurité</h3>
      <p className="text-sm text-gray-500 mb-6">Modifiez le mot de passe de votre compte</p>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-3 flex items-center space-x-2">
          <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {success && (
        <div className="mb-4 bg-green-50 border border-green-200 rounded-lg p-3 flex items-center space-x-2">
          <CheckCircle2 className="h-4 w-4 text-green-600 flex-shrink-0" />
          <p className="text-sm text-green-700">Mot de passe mis à jour</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Mot de passe actuel</label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type={showCurrent ? 'text' : 'password'}
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full pl-9 pr-10 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent"
              placeholder="Votre mot de passe actuel"
            />
            <button
              type="button"
              onClick={() => setShowCurrent(!showCurrent)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              tabIndex={-1}
            >
              {showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Nouveau mot de passe</label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type={showNew ? 'text' : 'password'}
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full pl-9 pr-10 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent"
              placeholder="Nouveau mot de passe"
            />
            <button
              type="button"
              onClick={() => setShowNew(!showNew)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              tabIndex={-1}
            >
              {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>

          {newPassword.length > 0 && (
            <ul className="mt-2 space-y-1">
              {PASSWORD_REQUIREMENTS.map((req) => {
                const met = req.test(newPassword);
                return (
                  <li
                    key={req.label}
                    className={`flex items-center gap-1.5 text-xs ${met ? 'text-green-600' : 'text-gray-400'}`}
                  >
                    {met ? <Check className="h-3 w-3" /> : <Circle className="h-3 w-3" />}
                    {req.label}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Confirmer le nouveau mot de passe</label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type={showNew ? 'text' : 'password'}
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className={`w-full pl-9 pr-3 py-2 border rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent ${
                confirmPassword.length > 0 && !passwordsMatch ? 'border-red-300' : 'border-gray-300'
              }`}
              placeholder="Retapez le nouveau mot de passe"
            />
          </div>
          {confirmPassword.length > 0 && (
            <p className={`mt-1.5 flex items-center gap-1.5 text-xs ${passwordsMatch ? 'text-green-600' : 'text-red-600'}`}>
              {passwordsMatch ? <Check className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
              {passwordsMatch ? 'Les mots de passe correspondent' : 'Les mots de passe ne correspondent pas'}
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={submitting || !canSubmit}
          className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
        >
          {submitting ? 'Mise à jour...' : 'Mettre à jour le mot de passe'}
        </button>
      </form>
    </div>
  );
};
