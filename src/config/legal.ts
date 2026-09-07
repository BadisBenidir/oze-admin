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

// Source : annuaire-entreprises.data.gouv.fr (INSEE/INPI), fiche OZE PARIS.
export const COMPANY_LEGAL_NAME = 'OZE PARIS, SAS';
export const COMPANY_SIRET = '105 405 211 00019';
export const COMPANY_RCS = 'RCS Paris 105 405 211';
export const COMPANY_JURISDICTION_CITY = 'Paris';
export const COMPANY_ADDRESS = '6 rue d\'Armaille, 75017 Paris';
export const COMPANY_VAT_NUMBER = 'FR10 105 405 211';
// Date de création d'OZË PARIS SAS (registre) — l'activité tournait avant
// cette date sous un statut différent (micro-entreprise) : le suivi du CA
// face au seuil de franchise en base (voir config/accounting.ts) ne doit
// compter que depuis cette date, jamais depuis le 1er janvier.
export const COMPANY_CREATION_DATE = '2026-05-20';
export const MEDIATOR_NAME = 'CM2C — Centre de la Médiation de la Consommation de Conciliateurs de Justice (14 rue Saint Jean, 75017 Paris, cm2c@cm2c.net)';
export const MEDIATOR_URL = 'https://www.cm2c.net';
