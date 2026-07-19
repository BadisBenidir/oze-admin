// Intégration du Service Point Picker de Sendcloud.
//
// Le widget officiel affiche une carte des points relais et gère la sélection.
// Il ne nécessite que la CLÉ PUBLIQUE d'intégration côté navigateur.
// ⚠️ La clé confidentielle ne doit JAMAIS être importée ici : elle sert
//    uniquement aux appels serveur (création d'étiquettes) et reste un secret
//    Supabase côté backend. Copié depuis oze-storefront (même compte Sendcloud).

import { ChronopostPickupPoint } from './chronopostService';

const SPP_SCRIPT_URL = 'https://embed.sendcloud.sc/spp/1.0.0/api.min.js';
const PUBLIC_KEY = import.meta.env.VITE_SENDCLOUD_PUBLIC_KEY as string;

// Transporteurs des points relais affichés. Colissimo (compte La Poste Pro) et
// Mondial Relay sont activés sur l'intégration. ⚠️ Mondial Relay doit aussi être
// activé sur ton compte Sendcloud, sinon ses points relais ne remontent pas.
// Chronopost reste indisponible sans contrat dédié, donc on ne le demande pas
// (sinon Sendcloud renvoie une 400 et la carte est vide).
const CARRIERS = 'colissimo,mondial_relay';

// Noms de pays (tels que stockés dans le formulaire) → code ISO 2 lettres.
const COUNTRY_CODES: Record<string, string> = {
  France: 'fr', Belgique: 'be', Luxembourg: 'lu', Monaco: 'mc',
  Suisse: 'ch', Allemagne: 'de', Espagne: 'es', Italie: 'it',
  'Pays-Bas': 'nl', Portugal: 'pt', 'Royaume-Uni': 'gb', Suède: 'se',
};

declare global {
  interface Window {
    sendcloud?: {
      servicePoints: {
        open: (
          config: Record<string, unknown>,
          onSuccess: (servicePoint: any, postNumber?: string) => void,
          onFailure: (errors: unknown) => void,
        ) => void;
      };
    };
  }
}

let scriptPromise: Promise<void> | null = null;

/** Charge le script du Service Point Picker une seule fois. */
function loadSendcloudScript(): Promise<void> {
  if (typeof window !== 'undefined' && window.sendcloud) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-sendcloud-spp]',
    );
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Échec de chargement du widget Sendcloud')), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = SPP_SCRIPT_URL;
    script.async = true;
    script.dataset.sendcloudSpp = 'true';
    script.addEventListener('load', () => resolve(), { once: true });
    script.addEventListener('error', () => reject(new Error('Échec de chargement du widget Sendcloud')), { once: true });
    document.head.appendChild(script);
  });

  return scriptPromise;
}

export interface OpenPickerOptions {
  postalCode: string;
  city: string;
  /** Nom complet du pays tel que stocké dans le formulaire (ex. « France »). */
  country: string;
  language?: string;
}

/**
 * Ouvre le Service Point Picker Sendcloud (Colissimo + Mondial Relay) et renvoie le
 * point relais sélectionné, ou `null` si l'utilisateur ferme sans choisir.
 */
export async function openServicePointPicker(
  opts: OpenPickerOptions,
): Promise<ChronopostPickupPoint | null> {
  await loadSendcloudScript();

  if (!window.sendcloud) {
    throw new Error('Widget Sendcloud indisponible');
  }

  const countryCode = COUNTRY_CODES[opts.country] || 'fr';

  return new Promise((resolve) => {
    window.sendcloud!.servicePoints.open(
      {
        apiKey: PUBLIC_KEY,
        country: countryCode,
        postalCode: opts.postalCode || '',
        city: opts.city || '',
        carriers: CARRIERS,
        language: opts.language || 'fr-fr',
      },
      (sp) => resolve(mapServicePoint(sp)),
      // Fermeture sans sélection ou erreur : on ne bloque pas l'UI, on renvoie null.
      () => resolve(null),
    );
  });
}

/** Normalise l'objet point relais Sendcloud vers notre type interne. */
function mapServicePoint(sp: any): ChronopostPickupPoint {
  const lat = parseFloat(sp.latitude);
  const lng = parseFloat(sp.longitude);
  return {
    code: String(sp.id ?? sp.code ?? ''),
    name: sp.name ?? '',
    // Nom du réseau renvoyé par Sendcloud (ex. « Colissimo »).
    network: sp.carrier_name ?? sp.carrier ?? 'Colissimo',
    address: [sp.street, sp.house_number].filter(Boolean).join(' ').trim(),
    city: sp.city ?? '',
    zipCode: sp.postal_code ?? '',
    country: (sp.country ?? 'FR').toUpperCase(),
    lat: Number.isFinite(lat) ? lat : 0,
    lng: Number.isFinite(lng) ? lng : 0,
    distance: typeof sp.distance === 'number' ? sp.distance : undefined,
  };
}
