/**
 * Constantes centralisant les informations juridiques d'OZË Paris utilisées
 * dans les CGV/CGU (Terms.tsx) — à remplacer par les vraies informations de
 * l'entreprise avant mise en production. Centralisées ici pour n'avoir
 * qu'un seul endroit à corriger plutôt que de les répéter dans le texte.
 */

/** Identifie la version des CGV acceptée par un revendeur (profiles.terms_version) —
 * incrémenter (ex: date de révision) à chaque changement substantiel du texte,
 * pour pouvoir un jour redemander un consentement explicite après mise à jour. */
export const CGV_VERSION = '2026-09-07';

// TODO: remplacer ces placeholders par les informations réelles d'OZË Paris.
export const COMPANY_LEGAL_NAME = '[Dénomination sociale d\'OZË Paris]';
export const COMPANY_SIRET = '[SIRET d\'OZË Paris]';
export const COMPANY_RCS = '[Ville et numéro RCS]';
export const COMPANY_JURISDICTION_CITY = '[Ville du siège social]';
export const COMPANY_ADDRESS = '[Adresse du siège social]';
export const MEDIATOR_NAME = '[Nom du médiateur de la consommation désigné]';
export const MEDIATOR_URL = '[URL de la plateforme du médiateur]';
