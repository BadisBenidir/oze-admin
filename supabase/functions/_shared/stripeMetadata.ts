// Stripe limite chaque valeur de metadata à 500 caractères (et 50 clés) : une
// longue valeur (ex. item_ids d'une demande de livraison de 21 articles) est
// découpée en `key`, `key_1`, `key_2`… et recollée par le webhook.

const MAX = 500;

export const splitMetadata = (key: string, value: string): Record<string, string> => {
  const out: Record<string, string> = { [key]: value.slice(0, MAX) };
  for (let i = 1; i * MAX < value.length; i++) out[`${key}_${i}`] = value.slice(i * MAX, (i + 1) * MAX);
  return out;
};

export const joinMetadata = (metadata: Record<string, string> | null | undefined, key: string): string => {
  if (!metadata) return '';
  let value = metadata[key] || '';
  for (let i = 1; metadata[`${key}_${i}`] !== undefined; i++) value += metadata[`${key}_${i}`];
  return value;
};
