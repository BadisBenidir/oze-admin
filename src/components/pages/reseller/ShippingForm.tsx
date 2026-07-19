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
  onSubmit: (selection: ShippingSelection) => void;
}

// Adapté de oze-storefront/ShippingForm.tsx : l'adresse d'un revendeur est
// configurée par un admin OZË sur la fiche entreprise (voir
// useResellerAuth/ResellerFormModal), jamais saisie par le revendeur — donc
// pas de formulaire d'adresse ici, seulement le choix du mode de livraison.
const ShippingForm: React.FC<ShippingFormProps> = ({ companyAddress, onSubmit }) => {
  const hasCompanyAddressInitially = Boolean(companyAddress.address && companyAddress.city && companyAddress.postalCode);
  const [deliveryType, setDeliveryType] = useState<DeliveryType>(hasCompanyAddressInitially ? 'domicile' : 'point_relais');
  const [selectedParcelPoint, setSelectedParcelPoint] = useState<ChronopostPickupPoint | null>(null);
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
      if (point) setSelectedParcelPoint(point);
    } catch (err) {
      setParcelPointError(err instanceof Error ? err.message : "Impossible d'ouvrir la carte des points relais");
    } finally {
      setPickerLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (deliveryType === 'point_relais' && !selectedParcelPoint) {
      setParcelPointError('Veuillez sélectionner un point relais');
      return;
    }
    if (deliveryType === 'domicile' && !hasCompanyAddress) {
      return;
    }
    setParcelPointError('');
    onSubmit({ deliveryType, parcelPoint: deliveryType === 'point_relais' ? selectedParcelPoint : null });
  };

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-6">Mode de livraison</h2>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <button
            type="button"
            onClick={() => setDeliveryType('domicile')}
            disabled={!hasCompanyAddress}
            className={`relative flex flex-col p-4 border-2 rounded-lg transition-all text-left disabled:opacity-40 disabled:cursor-not-allowed ${
              deliveryType === 'domicile' ? 'border-gray-900 bg-gray-50' : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center">
                <Home className={`h-5 w-5 mr-2 ${deliveryType === 'domicile' ? 'text-gray-900' : 'text-gray-400'}`} />
                <span className={`font-medium ${deliveryType === 'domicile' ? 'text-gray-900' : 'text-gray-700'}`}>
                  Livraison à l'entreprise
                </span>
              </div>
              <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                deliveryType === 'domicile' ? 'border-gray-900' : 'border-gray-300'
              }`}>
                {deliveryType === 'domicile' && <div className="w-3 h-3 rounded-full bg-gray-900" />}
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
            onClick={() => setDeliveryType('point_relais')}
            className={`relative flex flex-col p-4 border-2 rounded-lg transition-all text-left ${
              deliveryType === 'point_relais' ? 'border-gray-900 bg-gray-50' : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center">
                <Package className={`h-5 w-5 mr-2 ${deliveryType === 'point_relais' ? 'text-gray-900' : 'text-gray-400'}`} />
                <span className={`font-medium ${deliveryType === 'point_relais' ? 'text-gray-900' : 'text-gray-700'}`}>
                  Point Relais
                </span>
              </div>
              <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                deliveryType === 'point_relais' ? 'border-gray-900' : 'border-gray-300'
              }`}>
                {deliveryType === 'point_relais' && <div className="w-3 h-3 rounded-full bg-gray-900" />}
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

        {deliveryType === 'domicile' && (
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 flex items-start gap-2">
            <MapPin className="h-4 w-4 text-gray-400 flex-shrink-0 mt-0.5" />
            {hasCompanyAddress ? (
              <p className="text-sm text-gray-700">
                {companyAddress.address}, {companyAddress.postalCode} {companyAddress.city}, {companyAddress.country}
              </p>
            ) : (
              <p className="text-sm text-amber-700">
                Aucune adresse enregistrée pour votre entreprise. Contactez votre administrateur OZË.
              </p>
            )}
          </div>
        )}

        {deliveryType === 'point_relais' && (
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

        <button
          type="submit"
          className="w-full bg-gray-900 text-white py-3 rounded-lg font-medium hover:bg-gray-800 transition-colors"
        >
          Continuer vers le récapitulatif
        </button>
      </form>
    </div>
  );
};

export default ShippingForm;
