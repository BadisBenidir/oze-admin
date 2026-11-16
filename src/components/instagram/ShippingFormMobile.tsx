// Copie du formulaire de livraison du checkout d'oze-storefront
// (src/components/Checkout/ShippingForm*.tsx) pour les ventes Instagram :
// mêmes champs, mêmes validations, même rendu. Adaptations : livraison
// offerte, libellé du bouton, type d'adresse défini ici.
import React, { useState } from 'react';
import { User, Mail, Phone, MapPin, Lock, CheckCircle, Package, Home, Clock } from 'lucide-react';
import { DeliveryType, ShippingFormResult, ShippingAddress } from './ShippingForm';
import { ChronopostPickupPoint } from '../../services/chronopostService';
import { openServicePointPicker } from '../../services/sendcloudService';
import Autocomplete from "react-google-autocomplete";

interface ShippingFormMobileProps {
  initialData: ShippingAddress;
  isUserConnected?: boolean;
  onSubmit: (result: ShippingFormResult) => void;
  /** Voir ShippingForm.tsx (version desktop) pour le contexte de ce callback. */
  onAddressChange?: (address: ShippingAddress) => void;
}

const extractComponent = (components: any[], type: string) =>
  components.find((c) => c.types.includes(type))?.long_name || '';

const ShippingFormMobile: React.FC<ShippingFormMobileProps> = ({
  initialData,
  isUserConnected = false,
  onSubmit,
  onAddressChange
}) => {
  const [formData, setFormData] = useState<ShippingAddress>(initialData);
  const [errors, setErrors] = useState<Partial<ShippingAddress>>({});
  // Voir ShippingForm.tsx (version desktop) pour le contexte de cette bascule.
  const [manualAddressMode, setManualAddressMode] = useState(false);
  const [deliveryType, setDeliveryType] = useState<DeliveryType>('point_relais');
  const [selectedParcelPoint, setSelectedParcelPoint] = useState<ChronopostPickupPoint | null>(null);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [parcelPointError, setParcelPointError] = useState('');
  // Voir ShippingForm.tsx (version desktop) pour le contexte de cette bascule.
  const [manualRelayMode, setManualRelayMode] = useState(false);
  const [manualRelay, setManualRelay] = useState({
    carrier: 'Colissimo' as 'Colissimo' | 'Mondial Relay',
    name: '',
    address: '',
    postalCode: '',
    city: '',
  });

  React.useEffect(() => {
    onAddressChange?.(formData);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData]);

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
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Information utilisateur connecté */}
      {isUserConnected && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-3 mb-4">
          <div className="flex items-center">
            <CheckCircle className="h-4 w-4 text-green-600 mr-2" />
            <span className="text-sm font-medium text-green-800">
              Informations pré-remplies depuis votre profil
            </span>
          </div>
        </div>
      )}

      {/* Nom et Prénom */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Prénom <span className="text-red-500">*</span>
          </label>
          <div className="relative">
            <User className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              name="firstName"
              value={formData.firstName}
              onChange={handleInputChange}
              className={`w-full pl-10 pr-3 py-3 text-sm border rounded-xl focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black ${
                errors.firstName ? 'border-red-500' : 'border-gray-300'
              }`}
              placeholder="Prénom"
            />
          </div>
          {errors.firstName && <p className="text-red-500 text-xs mt-1">{errors.firstName}</p>}
        </div>
        
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Nom <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            name="lastName"
            value={formData.lastName}
            onChange={handleInputChange}
            className={`w-full px-3 py-3 text-sm border rounded-xl focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black ${
              errors.lastName ? 'border-red-500' : 'border-gray-300'
            }`}
            placeholder="Nom"
          />
          {errors.lastName && <p className="text-red-500 text-xs mt-1">{errors.lastName}</p>}
        </div>
      </div>

      {/* Email */}
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">
          Email <span className="text-red-500">*</span>
          {isUserConnected && (
            <span className="ml-2 text-xs text-blue-600 font-normal">
              (compte)
            </span>
          )}
        </label>
        <div className="relative">
          <Mail className={`absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 ${
            isUserConnected ? 'text-gray-500' : 'text-gray-400'
          }`} />
          {isUserConnected && (
            <Lock className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-500" />
          )}
          <input
            type="email"
            name="email"
            value={formData.email}
            onChange={handleInputChange}
            readOnly={isUserConnected}
            className={`w-full pl-10 py-3 text-sm border rounded-xl focus:outline-none ${
              isUserConnected 
                ? 'pr-10 bg-gray-50 text-gray-700 border-gray-300 cursor-not-allowed' 
                : `pr-3 focus:ring-2 focus:ring-black/20 focus:border-black ${errors.email ? 'border-red-500' : 'border-gray-300'}`
            }`}
            placeholder={isUserConnected ? '' : 'votre@email.com'}
          />
        </div>
        {errors.email && <p className="text-red-500 text-xs mt-1">{errors.email}</p>}
        {isUserConnected && (
          <p className="text-xs text-gray-600 mt-1 flex items-center">
            <CheckCircle className="w-3 h-3 mr-1 text-green-600" />
            Email verrouillé pour votre sécurité
          </p>
        )}
      </div>

      {/* Téléphone */}
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">
          Téléphone <span className="text-red-500">*</span>
        </label>
        <div className="relative">
          <Phone className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="tel"
            name="phone"
            value={formData.phone}
            onChange={handleInputChange}
            className={`w-full pl-10 pr-3 py-3 text-sm border rounded-xl focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black ${
              errors.phone ? 'border-red-500' : 'border-gray-300'
            }`}
            placeholder="+33 6 12 34 56 78"
          />
        </div>
        {errors.phone && <p className="text-red-500 text-xs mt-1">{errors.phone}</p>}
      </div>

      {/* Adresse */}
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">
          Adresse <span className="text-red-500">*</span>
        </label>
        {!manualAddressMode ? (
          <>
            <div className="relative">
              <MapPin className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
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
              <MapPin className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                name="address"
                value={formData.address}
                onChange={handleInputChange}
                className={`w-full pl-10 pr-3 py-3 text-sm border rounded-xl focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black ${
                  errors.address ? 'border-red-500' : 'border-gray-300'
                }`}
                placeholder="Numéro et nom de la rue"
              />
            </div>
            <div className="mt-3">
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Complément d'adresse (optionnel)
              </label>
              <input
                type="text"
                name="addressLine2"
                value={formData.addressLine2 || ''}
                onChange={handleInputChange}
                className="w-full px-3 py-3 text-sm border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black"
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
        {errors.address && <p className="text-red-500 text-xs mt-1">{errors.address}</p>}
      </div>

      {/* Ville et Code postal */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Ville <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            name="city"
            value={formData.city}
            onChange={handleInputChange}
            className={`w-full px-3 py-3 text-sm border rounded-xl focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black ${
              errors.city ? 'border-red-500' : 'border-gray-300'
            }`}
            placeholder="Paris"
          />
          {errors.city && <p className="text-red-500 text-xs mt-1">{errors.city}</p>}
        </div>
        
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Code postal <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            name="postalCode"
            value={formData.postalCode}
            onChange={handleInputChange}
            className={`w-full px-3 py-3 text-sm border rounded-xl focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black ${
              errors.postalCode ? 'border-red-500' : 'border-gray-300'
            }`}
            placeholder="75001"
          />
          {errors.postalCode && <p className="text-red-500 text-xs mt-1">{errors.postalCode}</p>}
        </div>
      </div>

      {/* Pays */}
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">
          Pays <span className="text-red-500">*</span>
        </label>
        <select
          name="country"
          value={formData.country}
          onChange={handleInputChange}
          className="w-full px-3 py-3 text-sm border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black bg-white"
        >
          <option value="France">France</option>
          <option value="Belgique">Belgique</option>
          <option value="Suisse">Suisse</option>
          <option value="Luxembourg">Luxembourg</option>
          <option value="Monaco">Monaco</option>
        </select>
      </div>

      <div className='h-4' />

      {/* Choix du type de livraison */}
      <div className="space-y-3 mb-4 mt-6">
        <label className="block text-xs font-medium text-gray-700">
          Mode de livraison <span className="text-red-500">*</span>
        </label>

          <div className="space-y-3">
          {/* Option Point Relais */}
          <button
            type="button"
            onClick={() => setDeliveryType('point_relais')}
            className={`w-full flex items-center justify-between p-3 border-2 rounded-xl transition-all ${
              deliveryType === 'point_relais'
                ? 'border-black bg-gray-50'
                : 'border-gray-200'
            }`}
          >
            <div className="flex items-center">
              <Package className={`h-5 w-5 mr-3 ${deliveryType === 'point_relais' ? 'text-black' : 'text-gray-400'}`} />
              <div className="text-left">
                <span className={`font-medium text-sm ${deliveryType === 'point_relais' ? 'text-black' : 'text-gray-700'}`}>
                  Point Relais
                </span>
                <p className="text-xs text-gray-500">Le plus proche de votre adresse</p>
                <p className="text-xs text-gray-500 flex items-center mt-0.5">
                  <Clock className="h-3 w-3 mr-1 flex-shrink-0" />
                  3 jours ouvrés
                </p>
              </div>
            </div>
            <div className="flex items-center">
              <span className="font-bold text-sm mr-2">Offerte</span>
              <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                deliveryType === 'point_relais' ? 'border-black' : 'border-gray-300'
              }`}>
                {deliveryType === 'point_relais' && (
                  <div className="w-3 h-3 rounded-full bg-black" />
                )}
              </div>
            </div>
          </button>

          {/* Option Adresse spécifique — indisponible pour les ventes Instagram */}
          <button
            type="button"
            disabled
            aria-disabled="true"
            className="w-full flex items-center justify-between p-3 border-2 rounded-xl border-gray-200 bg-gray-50 opacity-50 cursor-not-allowed"
          >
            <div className="flex items-center">
              <Home className={`h-5 w-5 mr-3 ${deliveryType === 'domicile' ? 'text-black' : 'text-gray-400'}`} />
              <div className="text-left">
                <span className={`font-medium text-sm ${deliveryType === 'domicile' ? 'text-black' : 'text-gray-700'}`}>
                  À une adresse
                </span>
                <p className="text-xs text-gray-500">Indisponible pour cette commande</p>
                <p className="text-xs text-gray-500 flex items-center mt-0.5">
                  <Clock className="h-3 w-3 mr-1 flex-shrink-0" />
                  Livrée le lendemain ou le surlendemain
                </p>
              </div>
            </div>
            <div className="flex items-center">
              <span className="font-bold text-sm mr-2">Offerte</span>
              <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                deliveryType === 'domicile' ? 'border-black' : 'border-gray-300'
              }`}>
                {deliveryType === 'domicile' && (
                  <div className="w-3 h-3 rounded-full bg-black" />
                )}
              </div>
            </div>
          </button>
        </div>

        {/* Sélection du point relais */}
        {deliveryType === 'point_relais' && (
          <div className="mt-3 space-y-2">
            {!manualRelayMode ? (
              <>
                {selectedParcelPoint ? (
                  <div className="bg-green-50 border border-green-200 rounded-xl p-3 flex items-start justify-between">
                    <div className="flex items-start min-w-0">
                      <CheckCircle className="h-5 w-5 text-green-600 mr-2 mt-0.5 flex-shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-green-800 truncate">{selectedParcelPoint.name}</p>
                        <p className="text-xs text-green-700 truncate">
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
                    className="w-full py-2 px-4 border-2 border-dashed border-gray-300 rounded-xl text-sm text-gray-600 hover:border-black hover:text-black transition-colors disabled:opacity-50"
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
              <div className="border border-gray-200 rounded-xl p-4 space-y-3">
                <p className="text-sm font-medium text-gray-900">Saisir un point relais manuellement</p>

                <div className="flex gap-4">
                  <label className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="radio"
                      name="manualRelayCarrierMobile"
                      checked={manualRelay.carrier === 'Colissimo'}
                      onChange={() => setManualRelay((prev) => ({ ...prev, carrier: 'Colissimo' }))}
                    />
                    Colissimo
                  </label>
                  <label className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="radio"
                      name="manualRelayCarrierMobile"
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
                    className="w-full px-3 py-2.5 text-sm border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black"
                    placeholder="Ex : Tabac de la Gare"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Adresse</label>
                  <input
                    type="text"
                    value={manualRelay.address}
                    onChange={(e) => setManualRelay((prev) => ({ ...prev, address: e.target.value }))}
                    className="w-full px-3 py-2.5 text-sm border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black"
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
                      className="w-full px-3 py-2.5 text-sm border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black"
                      placeholder="75001"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Ville</label>
                    <input
                      type="text"
                      value={manualRelay.city}
                      onChange={(e) => setManualRelay((prev) => ({ ...prev, city: e.target.value }))}
                      className="w-full px-3 py-2.5 text-sm border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black"
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
        className="w-full bg-black text-white py-3 rounded-xl font-medium hover:bg-gray-800 transition-colors mt-6"
      >
        Valider mes informations
      </button>
    </form>
  );
};

export default ShippingFormMobile;