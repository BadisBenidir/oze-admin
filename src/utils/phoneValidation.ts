// Validation légère du téléphone destinataire, requis par Sendcloud (Mondial
// Relay en particulier) — accepte les formats français courants et
// internationaux (espaces/points/tirets/parenthèses ignorés), sans viser une
// validation exhaustive. Dupliquée côté edge function (Deno n'importe pas ce
// module), même règle des deux côtés.
export const isPlausiblePhone = (raw: string | null | undefined): boolean => {
  const digits = String(raw || '').replace(/[\s.\-()]/g, '');
  return /^\+?[0-9]{8,15}$/.test(digits);
};
