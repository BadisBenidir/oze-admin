/**
 * Constantes comptables — OZË Paris est en franchise en base de TVA
 * (article 293 B du CGI, voir src/config/legal.ts et les CGV/Terms.tsx) :
 * aucune TVA n'est due sur les ventes tant que le chiffre d'affaires annuel
 * reste sous ce seuil. Le module Comptabilité affiche donc un suivi du CA
 * cumulé par rapport à ce plafond plutôt qu'un calcul de TVA sur marge.
 */

// Seuil de franchise en base pour une activité de vente de marchandises
// (BIC vente) — révisé périodiquement par la loi de finances, à vérifier/
// mettre à jour chaque année aux montants en vigueur (barème 2025 indiqué
// ici à titre de valeur de départ, jamais vérifié en direct par Claude).
export const FRANCHISE_TVA_THRESHOLD = 85000;
// Seuil majoré de tolérance : la franchise n'est perdue qu'après deux années
// consécutives de dépassement du seuil normal, ou immédiatement en cas de
// dépassement de ce seuil majoré.
export const FRANCHISE_TVA_TOLERANCE_THRESHOLD = 93500;
