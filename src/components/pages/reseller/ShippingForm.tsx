import React, { useState } from 'react';
import { MapPin, Package, Home, CheckCircle, Clock, AlertCircle } from 'lucide-react';
import { ChronopostPickupPoint } from '../../../services/chronopostService';
import { openServicePointPicker } from '../../../services/sendcloudService';

export type DeliveryType = 'point_relais' | 'domicile';

// Tarifs affichés côté client à titre indicatif — le prix réellement facturé
// est toujours recalculé côté serveur (b2b-checkout), jamais accepté tel quel.
export const SHIPPING_RATES: Record<DeliveryType, number> = {
  point_relais: 4.9,
  domicile: 14.9,
};

export interface ShippingSelection {
  deliveryType: DeliveryType;
  parcelPoint: ChronopostPickupPoint | null;
}

interface CompanyAddress {
  address: string;
  city: string;
  postalCode: string;
  country: string;
}

interface ShippingFormProps {
  companyAddress: CompanyAddress;
  value: ShippingSelection;
  onChange: (selection: ShippingSelection) => void;
}

// Adapté de oze-storefront/ShippingForm.tsx : l'adresse d'un revendeur est
// configurée par un admin OZË sur la fiche entreprise (voir
// useResellerAuth/ResellerFormModal), jamais saisie par le revendeur — donc
// pas de formulaire d'adresse ici, seulement le choix du mode de livraison.
// Composant contrôlé (pas d'étape/soumission propre) : fait partie de la
// page panier fusionnée, la sélection vit dans CartPage.
const ShippingForm: React.FC<ShippingFormProps> = ({ companyAddress, value, onChange }) => {
  const [searchPostalCode, setSearchPostalCode] = useState(companyAddress.postalCode);
  const [searchCity, setSearchCity] = useState(companyAddress.city);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [parcelPointError, setParcelPointError] = useState('');

  const hasCompanyAddress = Boolean(companyAddress.address && companyAddress.city && companyAddress.postalCode);

  const openPicker = async () => {
    if (!searchPostalCode || !searchCity) {
      setParcelPointError('Renseignez un code postal et une ville pour chercher un point relais');
      return;
    }
    setParcelPointError('');
    setPickerLoading(true);
    try {
      const point = await openServicePointPicker({
        postalCode: searchPostalCode,
        city: searchCity,
        country: companyAddress.country,
      });
      if (point) {
        onChange({ deliveryType: 'point_relais', parcelPoint: point });
      }
    } catch (err) {
      setParcelPointError(err instanceof Error ? err.message : "Impossible d'ouvrir la carte des points relais");
    } finally {
      setPickerLoading(false);
    }
  };

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-6">Mode de livraison</h2>

      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <button
            type="button"
            onClick={() => onChange({ deliveryType: 'domicile', parcelPoint: null })}
            disabled={!hasCompanyAddress}
            className={`relative flex flex-col p-4 border-2 rounded-lg transition-all text-left disabled:opacity-40 disabled:cursor-not-allowed ${
              value.deliveryType === 'domicile' ? 'border-gray-900 bg-gray-50' : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center">
                <Home className={`h-5 w-5 mr-2 ${value.deliveryType === 'domicile' ? 'text-gray-900' : 'text-gray-400'}`} />
                <span className={`font-medium ${value.deliveryType === 'domicile' ? 'text-gray-900' : 'text-gray-700'}`}>
                  Livraison à l'entreprise
                </span>
              </div>
              <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                value.deliveryType === 'domicile' ? 'border-gray-900' : 'border-gray-300'
              }`}>
                {value.deliveryType === 'domicile' && <div className="w-3 h-3 rounded-full bg-gray-900" />}
              </div>
            </div>
            <p className="text-sm text-gray-500">Livrée à l'adresse enregistrée de votre entreprise.</p>
            <p className="mt-1 flex items-center text-xs text-gray-500">
              <Clock className="h-3.5 w-3.5 mr-1 flex-shrink-0" />
              Livrée le lendemain ou le surlendemain
            </p>
            <div className="mt-2 text-lg font-bold text-gray-900">{SHIPPING_RATES.domicile.toFixed(2)} €</div>
          </button>

          <button
            type="button"
            onClick={() => onChange({ deliveryType: 'point_relais', parcelPoint: value.parcelPoint })}
            className={`relative flex flex-col p-4 border-2 rounded-lg transition-all text-left ${
              value.deliveryType === 'point_relais' ? 'border-gray-900 bg-gray-50' : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center">
                <Package className={`h-5 w-5 mr-2 ${value.deliveryType === 'point_relais' ? 'text-gray-900' : 'text-gray-400'}`} />
                <span className={`font-medium ${value.deliveryType === 'point_relais' ? 'text-gray-900' : 'text-gray-700'}`}>
                  Point Relais
                </span>
              </div>
              <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                value.deliveryType === 'point_relais' ? 'border-gray-900' : 'border-gray-300'
              }`}>
                {value.deliveryType === 'point_relais' && <div className="w-3 h-3 rounded-full bg-gray-900" />}
              </div>
            </div>
            <p className="text-sm text-gray-500">Retrait en point relais proche de vous.</p>
            <p className="mt-1 flex items-center text-xs text-gray-500">
              <Clock className="h-3.5 w-3.5 mr-1 flex-shrink-0" />
              3 jours ouvrés
            </p>
            <div className="mt-2 text-lg font-bold text-gray-900">{SHIPPING_RATES.point_relais.toFixed(2)} €</div>
          </button>
        </div>

        {value.deliveryType === 'domicile' && (
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 flex items-start gap-2">
            <MapPin className="h-4 w-4 text-gray-400 flex-shrink-0 mt-0.5" />
            {hasCompanyAddress ? (
              <p className="text-sm text-gray-700">
                {companyAddress.address}, {companyAddress.postalCode} {companyAddress.city}, {companyAddress.country}
              </p>
            ) : (
              <p className="text-sm text-amber-700">
                Aucune adresse enregistrée sur votre profil. Complétez-la dans "Mon profil" pour activer ce mode de livraison.
              </p>
            )}
          </div>
        )}

        {value.deliveryType === 'point_relais' && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Ville de recherche</label>
                <input
                  type="text"
                  value={searchCity}
                  onChange={(e) => setSearchCity(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-gray-400"
                  placeholder="Paris"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Code postal de recherche</label>
                <input
                  type="text"
                  value={searchPostalCode}
                  onChange={(e) => setSearchPostalCode(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-gray-400"
                  placeholder="75001"
                />
              </div>
            </div>

            {value.parcelPoint ? (
              <div className="bg-green-50 border border-green-200 rounded-lg p-3 flex items-start justify-between">
                <div className="flex items-start">
                  <CheckCircle className="h-5 w-5 text-green-600 mr-2 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-green-800">{value.parcelPoint.name}</p>
                    <p className="text-xs text-green-700">
                      {value.parcelPoint.address && `${value.parcelPoint.address}, `}
                      {value.parcelPoint.zipCode} {value.parcelPoint.city}
                    </p>
                    <p className="text-xs text-green-600 mt-0.5">{value.parcelPoint.network}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={openPicker}
                  disabled={pickerLoading}
                  className="text-xs text-gray-900 underline ml-3 whitespace-nowrap hover:text-gray-600 disabled:opacity-50"
                >
                  Changer
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={openPicker}
                disabled={pickerLoading}
                className="w-full py-2 px-4 border-2 border-dashed border-gray-300 rounded-lg text-sm text-gray-600 hover:border-gray-900 hover:text-gray-900 transition-colors disabled:opacity-50"
              >
                {pickerLoading ? 'Ouverture de la carte…' : 'Choisir un point relais'}
              </button>
            )}
            {parcelPointError && (
              <p className="text-xs text-red-600 flex items-center gap-1">
                <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                {parcelPointError}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default ShippingForm;
