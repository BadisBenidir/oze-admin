// Copie du formulaire de livraison du checkout d'oze-storefront
// (src/components/Checkout/ShippingForm*.tsx) pour les ventes Instagram :
// mêmes champs, mêmes validations, même rendu. Adaptations : livraison
// offerte, libellé du bouton, type d'adresse défini ici.
import React, { useState } from 'react';
import { User, Mail, Phone, MapPin, Package, Home, CheckCircle, Clock } from 'lucide-react';
import Autocomplete from "react-google-autocomplete";
import { ChronopostPickupPoint } from '../../services/chronopostService';
import { openServicePointPicker } from '../../services/sendcloudService';

export type DeliveryType = 'point_relais' | 'domicile';

export interface ShippingAddress {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
  /** Bâtiment, étage, appartement... — saisi manuellement, jamais renseigné par Google Places. */
  addressLine2?: string;
  city: string;
  postalCode: string;
  country: string;
  company?: string;
}

export interface ShippingFormResult {
  address: ShippingAddress;
  deliveryType: DeliveryType;
  selectedParcelPoint?: ChronopostPickupPoint | null;
}

interface ShippingFormProps {
  initialData: ShippingAddress;
  isUserConnected?: boolean;
  onSubmit: (result: ShippingFormResult) => void;
  onDeliveryTypeChange?: (type: DeliveryType) => void;
  /**
   * Remonte l'adresse (email inclus) à CHAQUE saisie, pas seulement au
   * submit — le code promo (rendu par le parent, visible dès cette étape)
   * lit l'email depuis son propre state ; sans ce callback, il ne voit
   * qu'une valeur restée à l'initiale tant que "Continuer vers le paiement"
   * n'a pas été cliqué.
   */
  onAddressChange?: (address: ShippingAddress) => void;
}

const extractComponent = (components: any[], type: string) => 
  components.find((c) => c.types.includes(type))?.long_name || '';

const ShippingForm: React.FC<ShippingFormProps> = ({ initialData, isUserConnected = false, onSubmit, onDeliveryTypeChange, onAddressChange }) => {
  const [formData, setFormData] = useState<ShippingAddress>(initialData);
  const [errors, setErrors] = useState<Partial<ShippingAddress>>({});
  // Bascule "Adresse introuvable ? Saisir manuellement" : Google Places ne
  // suggère parfois rien pour une résidence récente ou une adresse en
  // campagne — l'utilisateur peut alors passer sur un champ texte classique
  // au lieu de rester bloqué devant une liste de suggestions vide.
  const [manualAddressMode, setManualAddressMode] = useState(false);
  const [deliveryType, setDeliveryType] = useState<DeliveryType>('point_relais');
  const [selectedParcelPoint, setSelectedParcelPoint] = useState<ChronopostPickupPoint | null>(null);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [parcelPointError, setParcelPointError] = useState('');
  // Bascule "Point relais introuvable ?" : le Service Point Picker Sendcloud
  // peut ne rien trouver près de certaines adresses — le client peut alors
  // décrire lui-même le point relais plutôt que de rester bloqué.
  const [manualRelayMode, setManualRelayMode] = useState(false);
  const [manualRelay, setManualRelay] = useState({
    carrier: 'Colissimo' as 'Colissimo' | 'Mondial Relay',
    name: '',
    address: '',
    postalCode: '',
    city: '',
  });

  // Ouvre le Service Point Picker Sendcloud (Colissimo).
  const openPicker = async () => {
    if (!formData.postalCode || !formData.city) {
      setParcelPointError('Renseignez votre code postal et ville avant de choisir un point relais');
      return;
    }
    setParcelPointError('');
    setPickerLoading(true);
    try {
      const point = await openServicePointPicker({
        postalCode: formData.postalCode,
        city: formData.city,
        country: formData.country,
      });
      if (point) setSelectedParcelPoint(point);
    } catch (err) {
      setParcelPointError(
        err instanceof Error ? err.message : 'Impossible d\'ouvrir la carte des points relais',
      );
    } finally {
      setPickerLoading(false);
    }
  };

  React.useEffect(() => {
    if (onDeliveryTypeChange) {
      onDeliveryTypeChange(deliveryType);
    }
  }, [deliveryType, onDeliveryTypeChange]);

  React.useEffect(() => {
    onAddressChange?.(formData);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    if (errors[name as keyof ShippingAddress]) {
      setErrors(prev => ({ ...prev, [name]: '' }));
    }
  };

  const validateForm = () => {
    const newErrors: Partial<ShippingAddress> = {};
    
    if (!formData.firstName.trim()) newErrors.firstName = 'Prénom requis';
    if (!formData.lastName.trim()) newErrors.lastName = 'Nom requis';
    if (!formData.email.trim()) newErrors.email = 'Email requis';
    if (!formData.phone.trim()) newErrors.phone = 'Téléphone requis';
    if (!formData.address.trim()) newErrors.address = 'Adresse requise';
    if (!formData.city.trim()) newErrors.city = 'Ville requise';
    if (!formData.postalCode.trim()) newErrors.postalCode = 'Code postal requis';
    
    // Email validation
    if (formData.email && !/\S+@\S+\.\S+/.test(formData.email)) {
      newErrors.email = 'Email invalide';
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    let finalParcelPoint = selectedParcelPoint;
    if (deliveryType === 'point_relais') {
      if (manualRelayMode) {
        if (!manualRelay.name.trim() || !manualRelay.address.trim() || !manualRelay.postalCode.trim() || !manualRelay.city.trim()) {
          setParcelPointError('Veuillez renseigner le nom, l\'adresse, le code postal et la ville du point relais.');
          return;
        }
        finalParcelPoint = {
          code: '',
          name: manualRelay.name.trim(),
          network: manualRelay.carrier,
          address: manualRelay.address.trim(),
          city: manualRelay.city.trim(),
          zipCode: manualRelay.postalCode.trim(),
          country: formData.country,
          lat: 0,
          lng: 0,
        };
      } else if (!selectedParcelPoint) {
        setParcelPointError('Veuillez sélectionner un point relais');
        return;
      }
    }
    setParcelPointError('');
    if (validateForm()) {
      onSubmit({ address: formData, deliveryType, selectedParcelPoint: finalParcelPoint });
    }
  };

  return (
    <div className="bg-white border border-gray-200 p-6">
      <h2 className="text-xl font-semibold mb-6">Adresse de livraison</h2>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Name Fields */}
        <label className="block text-sm font-medium text-gray-700 mb-3">
            Informations de Livraison <span className="text-red-500">*</span>
          </label>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Prénom <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
              <input
                type="text"
                name="firstName"
                value={formData.firstName}
                onChange={handleInputChange}
                className={`w-full pl-10 pr-4 py-3 border focus:outline-none focus:border-black ${
                  errors.firstName ? 'border-red-500' : 'border-gray-300'
                }`}
                placeholder="Prénom"
              />
            </div>
            {errors.firstName && <p className="text-red-500 text-sm mt-1">{errors.firstName}</p>}
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Nom <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              name="lastName"
              value={formData.lastName}
              onChange={handleInputChange}
              className={`w-full px-4 py-3 border focus:outline-none focus:border-black ${
                errors.lastName ? 'border-red-500' : 'border-gray-300'
              }`}
              placeholder="Nom"
            />
            {errors.lastName && <p className="text-red-500 text-sm mt-1">{errors.lastName}</p>}
          </div>
        </div>

        {/* Contact Fields */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Email <span className="text-red-500">*</span>
              {isUserConnected && (
                <span className="ml-2 text-xs text-blue-600 font-normal">
                  (adresse de votre compte)
                </span>
              )}
            </label>
            <div className="relative">
              <Mail className={`absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 ${
                isUserConnected ? 'text-gray-500' : 'text-gray-400'
              }`} />
              {isUserConnected && (
                <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                  <svg className="w-4 h-4 text-gray-500" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                  </svg>
                </div>
              )}
              <input
                type="email"
                name="email"
                value={formData.email}
                onChange={handleInputChange}
                readOnly={isUserConnected}
                className={`w-full pl-10 py-3 border focus:outline-none ${
                  isUserConnected 
                    ? 'pr-10 bg-gray-50 text-gray-700 border-gray-300 cursor-not-allowed' 
                    : `pr-4 focus:border-black ${errors.email ? 'border-red-500' : 'border-gray-300'}`
                }`}
                placeholder={isUserConnected ? '' : 'votre@email.com'}
              />
            </div>
            {errors.email && <p className="text-red-500 text-sm mt-1">{errors.email}</p>}
            {isUserConnected && (
              <p className="text-xs text-gray-600 mt-1 flex items-center">
                <svg className="w-3 h-3 mr-1 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                Email verrouillé pour votre sécurité
              </p>
            )}
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Téléphone <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <Phone className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
              <input
                type="tel"
                name="phone"
                value={formData.phone}
                onChange={handleInputChange}
                className={`w-full pl-10 pr-4 py-3 border focus:outline-none focus:border-black ${
                  errors.phone ? 'border-red-500' : 'border-gray-300'
                }`}
                placeholder="+33 6 12 34 56 78"
              />
            </div>
            {errors.phone && <p className="text-red-500 text-sm mt-1">{errors.phone}</p>}
          </div>
        </div>


        {/* Address */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Adresse <span className="text-red-500">*</span>
          </label>
          {!manualAddressMode ? (
            <>
              <div className="relative">
                <MapPin className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
                <Autocomplete
                  apiKey={import.meta.env.VITE_GOOGLE_MAPS_KEY} // ou process.env... selon ton build
                  defaultValue={formData.address}
                  onChange={(e: any) => {
                    const value = e.target.value;
                    setFormData((prev) => ({ ...prev, address: value }));
                  }}
                  onPlaceSelected={(place: any) => {
                    const components = place.address_components || [];

                    const city =
                      extractComponent(components, "locality") ||
                      extractComponent(components, "postal_town") ||
                      extractComponent(components, "administrative_area_level_2");

                    // Rue seule (numéro + voie) — pas l'adresse formatée complète,
                    // pour ne pas dupliquer CP/ville/pays dans le champ adresse.
                    const street = [
                      extractComponent(components, "street_number"),
                      extractComponent(components, "route"),
                    ].filter(Boolean).join(" ").trim();

                    setFormData((prev) => ({
                      ...prev,
                      address: street || (place.formatted_address || "").split(",")[0] || "",
                      city,
                      postalCode: extractComponent(components, "postal_code"),
                    }));
                  }}
                  options={{
                    types: ["address"],
                    componentRestrictions: { country: "fr" },
                  }}
                  className={`w-full pl-10 pr-4 py-3 border focus:outline-none focus:border-black ${
                    errors.address ? "border-red-500" : "border-gray-300"
                  }`}
                />
              </div>
              <button
                type="button"
                onClick={() => setManualAddressMode(true)}
                className="mt-1.5 text-xs text-gray-500 underline hover:text-black"
              >
                Adresse introuvable ? Saisir manuellement
              </button>
            </>
          ) : (
            <>
              <div className="relative">
                <MapPin className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
                <input
                  type="text"
                  name="address"
                  value={formData.address}
                  onChange={handleInputChange}
                  className={`w-full pl-10 pr-4 py-3 border focus:outline-none focus:border-black ${
                    errors.address ? 'border-red-500' : 'border-gray-300'
                  }`}
                  placeholder="Numéro et nom de la rue"
                />
              </div>
              <div className="mt-3">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Complément d'adresse (optionnel)
                </label>
                <input
                  type="text"
                  name="addressLine2"
                  value={formData.addressLine2 || ''}
                  onChange={handleInputChange}
                  className="w-full px-4 py-3 border border-gray-300 focus:outline-none focus:border-black"
                  placeholder="Bâtiment, étage, appartement..."
                />
              </div>
              <button
                type="button"
                onClick={() => setManualAddressMode(false)}
                className="mt-1.5 text-xs text-gray-500 underline hover:text-black"
              >
                Revenir à la recherche automatique
              </button>
            </>
          )}
          {errors.address && <p className="text-red-500 text-sm mt-1">{errors.address}</p>}
        </div>

        {/* City and Postal Code */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Ville <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              name="city"
              value={formData.city}
              onChange={handleInputChange}
              className={`w-full px-4 py-3 border focus:outline-none focus:border-black ${
                errors.city ? 'border-red-500' : 'border-gray-300'
              }`}
              placeholder="Paris"
            />
            {errors.city && <p className="text-red-500 text-sm mt-1">{errors.city}</p>}
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Code postal <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              name="postalCode"
              value={formData.postalCode}
              onChange={handleInputChange}
              className={`w-full px-4 py-3 border focus:outline-none focus:border-black ${
                errors.postalCode ? 'border-red-500' : 'border-gray-300'
              }`}
              placeholder="75001"
            />
            {errors.postalCode && <p className="text-red-500 text-sm mt-1">{errors.postalCode}</p>}
          </div>
        </div>

        {/* Country */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Pays <span className="text-red-500">*</span>
          </label>
          <select
            name="country"
            value={formData.country}
            onChange={handleInputChange}
            className="w-full px-4 py-3 border border-gray-300 focus:outline-none focus:border-black"
          >
            <option value="France">France</option>
            <option value="Belgique">Belgique</option>
            <option value="Suisse">Suisse</option>
            <option value="Luxembourg">Luxembourg</option>
            <option value="Monaco">Monaco</option>
          </select>
        </div>

        {/* Choix du type de livraison */}
        <div className="space-y-3">
          <label className="block text-sm font-medium text-gray-700 mb-3">
            Mode de livraison <span className="text-red-500">*</span>
          </label>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Option Point Relais */}
            <button
              type="button"
              onClick={() => setDeliveryType('point_relais')}
              className={`relative flex flex-col p-4 border-2 rounded-lg transition-all ${
                deliveryType === 'point_relais'
                  ? 'border-black bg-gray-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center">
                  <Package className={`h-5 w-5 mr-2 ${deliveryType === 'point_relais' ? 'text-black' : 'text-gray-400'}`} />
                  <span className={`font-medium ${deliveryType === 'point_relais' ? 'text-black' : 'text-gray-700'}`}>
                    Point Relais
                  </span>
                </div>
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                  deliveryType === 'point_relais' ? 'border-black' : 'border-gray-300'
                }`}>
                  {deliveryType === 'point_relais' && (
                    <div className="w-3 h-3 rounded-full bg-black" />
                  )}
                </div>
              </div>
              <p className="text-sm text-gray-500 text-left">
                Retrait en point relais
              </p>
              <p className="mt-1 flex items-center text-xs text-gray-500 text-left">
                <Clock className="h-3.5 w-3.5 mr-1 flex-shrink-0" />
                3 jours ouvrés
              </p>
              <div className="mt-2 text-lg font-bold text-black">
                Offerte
              </div>
            </button>

            {/* Option Adresse spécifique — indisponible pour les ventes Instagram */}
            <button
              type="button"
              disabled
              aria-disabled="true"
              className="relative flex flex-col p-4 border-2 rounded-lg border-gray-200 bg-gray-50 opacity-50 cursor-not-allowed"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center">
                  <Home className={`h-5 w-5 mr-2 ${deliveryType === 'domicile' ? 'text-black' : 'text-gray-400'}`} />
                  <span className={`font-medium ${deliveryType === 'domicile' ? 'text-black' : 'text-gray-700'}`}>
                    À une adresse
                  </span>
                </div>
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                  deliveryType === 'domicile' ? 'border-black' : 'border-gray-300'
                }`}>
                  {deliveryType === 'domicile' && (
                    <div className="w-3 h-3 rounded-full bg-black" />
                  )}
                </div>
              </div>
              <p className="text-sm text-gray-500 text-left">
                Indisponible pour cette commande
              </p>
              <p className="mt-1 flex items-center text-xs text-gray-500 text-left">
                <Clock className="h-3.5 w-3.5 mr-1 flex-shrink-0" />
                Livrée le lendemain ou le surlendemain
              </p>
              <div className="mt-2 text-lg font-bold text-black">
                Offerte
              </div>
            </button>
          </div>

          {deliveryType === 'point_relais' && (
            <div className="mt-3 space-y-2">
              {!manualRelayMode ? (
                <>
                  {selectedParcelPoint ? (
                    <div className="bg-green-50 border border-green-200 rounded-lg p-3 flex items-start justify-between">
                      <div className="flex items-start">
                        <CheckCircle className="h-5 w-5 text-green-600 mr-2 mt-0.5 flex-shrink-0" />
                        <div>
                          <p className="text-sm font-semibold text-green-800">{selectedParcelPoint.name}</p>
                          <p className="text-xs text-green-700">
                            {selectedParcelPoint.address && `${selectedParcelPoint.address}, `}
                            {selectedParcelPoint.zipCode} {selectedParcelPoint.city}
                          </p>
                          <p className="text-xs text-green-600 mt-0.5">{selectedParcelPoint.network}</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={openPicker}
                        disabled={pickerLoading}
                        className="text-xs text-black underline ml-3 whitespace-nowrap hover:text-gray-600 disabled:opacity-50"
                      >
                        Changer
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={openPicker}
                      disabled={pickerLoading}
                      className="w-full py-2 px-4 border-2 border-dashed border-gray-300 rounded-lg text-sm text-gray-600 hover:border-black hover:text-black transition-colors disabled:opacity-50"
                    >
                      {pickerLoading ? 'Ouverture de la carte…' : 'Choisir un point relais'}
                    </button>
                  )}
                  {parcelPointError && (
                    <p className="text-xs text-red-600">{parcelPointError}</p>
                  )}
                  <button
                    type="button"
                    onClick={() => { setManualRelayMode(true); setParcelPointError(''); }}
                    className="text-xs text-gray-500 underline hover:text-black"
                  >
                    Point relais introuvable ?
                  </button>
                </>
              ) : (
                <div className="border border-gray-200 rounded-lg p-4 space-y-3">
                  <p className="text-sm font-medium text-gray-900">Saisir un point relais manuellement</p>

                  <div className="flex gap-4">
                    <label className="flex items-center gap-2 text-sm text-gray-700">
                      <input
                        type="radio"
                        name="manualRelayCarrier"
                        checked={manualRelay.carrier === 'Colissimo'}
                        onChange={() => setManualRelay((prev) => ({ ...prev, carrier: 'Colissimo' }))}
                      />
                      Colissimo
                    </label>
                    <label className="flex items-center gap-2 text-sm text-gray-700">
                      <input
                        type="radio"
                        name="manualRelayCarrier"
                        checked={manualRelay.carrier === 'Mondial Relay'}
                        onChange={() => setManualRelay((prev) => ({ ...prev, carrier: 'Mondial Relay' }))}
                      />
                      Mondial Relay
                    </label>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Nom du point relais</label>
                    <input
                      type="text"
                      value={manualRelay.name}
                      onChange={(e) => setManualRelay((prev) => ({ ...prev, name: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 text-sm focus:outline-none focus:border-black"
                      placeholder="Ex : Tabac de la Gare"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Adresse</label>
                    <input
                      type="text"
                      value={manualRelay.address}
                      onChange={(e) => setManualRelay((prev) => ({ ...prev, address: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 text-sm focus:outline-none focus:border-black"
                      placeholder="12 rue de la Gare"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Code postal</label>
                      <input
                        type="text"
                        value={manualRelay.postalCode}
                        onChange={(e) => setManualRelay((prev) => ({ ...prev, postalCode: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 text-sm focus:outline-none focus:border-black"
                        placeholder="75001"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Ville</label>
                      <input
                        type="text"
                        value={manualRelay.city}
                        onChange={(e) => setManualRelay((prev) => ({ ...prev, city: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 text-sm focus:outline-none focus:border-black"
                        placeholder="Paris"
                      />
                    </div>
                  </div>

                  {parcelPointError && (
                    <p className="text-xs text-red-600">{parcelPointError}</p>
                  )}

                  <button
                    type="button"
                    onClick={() => { setManualRelayMode(false); setParcelPointError(''); }}
                    className="text-xs text-gray-500 underline hover:text-black"
                  >
                    Revenir à la recherche automatique
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Submit Button */}
        <button
          type="submit"
          className="w-full bg-black text-white py-3 font-medium hover:bg-gray-800 transition-colors"
        >
          Valider mes informations
        </button>
      </form>
    </div>
  );
};

export default ShippingForm;