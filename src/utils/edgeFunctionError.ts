/**
 * `supabase.functions.invoke()` renvoie, sur un statut non-2xx, une
 * FunctionsHttpError dont `.message` est un texte générique fixe
 * ("Edge Function returned a non-2xx status code") — le vrai message
 * qu'on a nous-mêmes renvoyé dans le corps JSON (`{ error: "..." }`)
 * reste accessible uniquement via `.context` (la Response brute). Sans ce
 * helper, toute erreur métier (secrets manquants, API tierce en échec...)
 * s'affiche comme un message inexploitable côté UI.
 */
export const extractFunctionErrorMessage = async (error: unknown, fallback = 'Erreur inconnue'): Promise<string> => {
  const context = (error as { context?: unknown })?.context;
  if (context && typeof (context as Response).json === 'function') {
    try {
      const body = await (context as Response).json();
      if (body?.error) return String(body.error);
    } catch {
      // Corps non-JSON ou déjà consommé — on retombe sur le message générique.
    }
  }
  return (error as { message?: string })?.message || fallback;
};
