// Type partagé du point relais sélectionné dans le checkout.
//
// Alimenté par le Service Point Picker de Sendcloud (voir `sendcloudService.ts`).
// Identique à oze-storefront, pour garder la même forme de bout en bout.

/** Un point relais normalisé, partagé par tout le checkout. */
export interface ChronopostPickupPoint {
  /** Identifiant du point relais (id Sendcloud). */
  code: string;
  /** Nom commercial du point relais. */
  name: string;
  /** Réseau transporteur (ex. « Colissimo »). */
  network: string;
  /** Adresse (numéro + voie). */
  address: string;
  city: string;
  zipCode: string;
  /** Code pays ISO (ex. « FR »). */
  country: string;
  lat: number;
  lng: number;
  /** Distance à l'adresse recherchée, en mètres (si fournie). */
  distance?: number;
  /** Horaires d'ouverture résumés (si fournis). */
  openingHours?: string;
}
