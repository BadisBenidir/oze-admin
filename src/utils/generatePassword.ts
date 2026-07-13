// Génération de mot de passe temporaire, partagée par tous les écrans qui en
// créent un (nouveau revendeur, invitation de contact, réinitialisation).
//
// - Caractères ambigus exclus (I, O, l, 0, 1) : ces mots de passe sont
//   destinés à être transmis à l'oral ou copiés-collés par un humain.
// - Utilise crypto.getRandomValues (aléatoire cryptographiquement sûr) plutôt
//   que Math.random(), qui n'est pas conçu pour un usage sécurité.
// - Les 4 catégories obligatoires sont placées à des positions aléatoires
//   (mélange Fisher-Yates) plutôt qu'en tête, pour ne pas rendre la
//   structure du mot de passe prévisible.

const UPPERCASE = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWERCASE = 'abcdefghijkmnpqrstuvwxyz';
const DIGITS = '23456789';
const SPECIAL = '!@#$%^&*()_+-=[]{}|;:,.<>?';
const ALL_CHARS = UPPERCASE + LOWERCASE + DIGITS + SPECIAL;

const secureRandomInt = (maxExclusive: number): number => {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  return array[0] % maxExclusive;
};

const pickRandomChar = (charset: string): string => charset[secureRandomInt(charset.length)];

/**
 * Génère un mot de passe temporaire d'au moins 12 caractères, garantissant
 * au moins une majuscule, une minuscule, un chiffre et un caractère spécial.
 */
export const generateSecurePassword = (length = 14): string => {
  const safeLength = Math.max(length, 12);

  const requiredChars = [
    pickRandomChar(UPPERCASE),
    pickRandomChar(LOWERCASE),
    pickRandomChar(DIGITS),
    pickRandomChar(SPECIAL),
  ];

  const fillerChars = Array.from({ length: safeLength - requiredChars.length }, () => pickRandomChar(ALL_CHARS));

  const chars = [...requiredChars, ...fillerChars];

  for (let i = chars.length - 1; i > 0; i--) {
    const j = secureRandomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }

  return chars.join('');
};
