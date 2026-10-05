/**
 * Lien WhatsApp ouvrant directement la discussion avec un numéro (wa.me).
 * wa.me exige le format international sans « + » ni espaces : les numéros
 * français saisis en national (06 12 34 56 78) sont convertis en 336…,
 * « 0033 » et « +33 » sont normalisés. Renvoie null si le numéro est inexploitable.
 */
export const whatsappUrl = (phone: string | null | undefined): string | null => {
  if (!phone) return null;
  let digits = phone.trim().replace(/[^0-9+]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  else if (digits.startsWith('00')) digits = digits.slice(2);
  else if (digits.startsWith('0') && digits.length === 10) digits = `33${digits.slice(1)}`;
  digits = digits.replace(/[^0-9]/g, '');
  return digits.length >= 8 ? `https://wa.me/${digits}` : null;
};
