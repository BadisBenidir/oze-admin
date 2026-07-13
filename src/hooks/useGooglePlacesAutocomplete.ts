import { useEffect, useRef, type RefObject } from 'react';

// Le SDK Google Maps n'a pas de types officiels légers installés dans ce
// projet ; on reste volontairement en `any` sur l'objet `window.google`
// plutôt que d'ajouter une dépendance de types juste pour ce hook.
declare global {
  interface Window {
    google?: any;
  }
}

let scriptLoadingPromise: Promise<void> | null = null;

const loadGoogleMapsScript = (apiKey: string): Promise<void> => {
  if (window.google?.maps?.places) {
    return Promise.resolve();
  }
  if (scriptLoadingPromise) {
    return scriptLoadingPromise;
  }

  scriptLoadingPromise = new Promise((resolve, reject) => {
    const callbackName = '__ozeGoogleMapsLoaded';
    (window as any)[callbackName] = () => resolve();

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places&loading=async&callback=${callbackName}`;
    script.async = true;
    script.onerror = () => reject(new Error('Impossible de charger Google Maps'));
    document.head.appendChild(script);
  });

  return scriptLoadingPromise;
};

export interface AutocompletedAddress {
  line1: string;
  city: string;
  postal_code: string;
  country: string;
}

const getComponent = (components: any[], type: string): string =>
  components.find((c) => c.types.includes(type))?.long_name || '';

/**
 * Branche l'autocomplétion d'adresse Google Places sur un <input> existant.
 * Ne fait rien si VITE_GOOGLE_MAPS_API_KEY n'est pas configurée (le champ
 * reste un simple champ texte, pas de suggestion).
 */
export const useGooglePlacesAutocomplete = (
  inputRef: RefObject<HTMLInputElement>,
  onSelect: (address: AutocompletedAddress) => void
) => {
  const autocompleteRef = useRef<any>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
    if (!apiKey || !inputRef.current) return;

    let cancelled = false;

    loadGoogleMapsScript(apiKey)
      .then(() => {
        if (cancelled || !inputRef.current || !window.google) return;

        autocompleteRef.current = new window.google.maps.places.Autocomplete(inputRef.current, {
          types: ['address'],
          fields: ['address_components'],
        });

        autocompleteRef.current.addListener('place_changed', () => {
          const place = autocompleteRef.current.getPlace();
          const components = place?.address_components || [];
          if (components.length === 0) return;

          const streetNumber = getComponent(components, 'street_number');
          const route = getComponent(components, 'route');
          const city =
            getComponent(components, 'locality') ||
            getComponent(components, 'postal_town') ||
            getComponent(components, 'administrative_area_level_2');
          const postalCode = getComponent(components, 'postal_code');
          const country = getComponent(components, 'country');

          onSelectRef.current({
            line1: [streetNumber, route].filter(Boolean).join(' '),
            city,
            postal_code: postalCode,
            country: country || 'France',
          });
        });
      })
      .catch((err) => {
        console.error('Erreur de chargement Google Maps:', err);
      });

    return () => {
      cancelled = true;
      if (autocompleteRef.current && window.google) {
        window.google.maps.event.clearInstanceListeners(autocompleteRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
};
