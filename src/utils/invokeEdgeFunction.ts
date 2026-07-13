import { supabase } from '../lib/supabase';

interface InvokeResult<T> {
  data: T | null;
  error: string | null;
}

/**
 * Appelle une Edge Function et récupère le vrai message d'erreur renvoyé
 * dans le corps JSON, même sur une réponse non-2xx.
 *
 * supabase-js ne parse PAS automatiquement le corps d'une réponse en erreur :
 * `error` contient un message générique ("Edge Function returned a non-2xx
 * status code") et `data` reste `null`, même si l'Edge Function a renvoyé un
 * JSON `{ error: "raison précise" }`. Le vrai corps est accessible via
 * `error.context` (le Response brut) — c'est ce qu'on va chercher ici.
 */
export const invokeEdgeFunction = async <T = Record<string, unknown>>(
  functionName: string,
  body: Record<string, unknown>
): Promise<InvokeResult<T>> => {
  const { data, error } = await supabase.functions.invoke(functionName, { body });

  if (error) {
    let message = error.message || 'Une erreur est survenue';
    const context = (error as unknown as { context?: Response }).context;

    if (context && typeof context.json === 'function') {
      try {
        const parsed = await context.json();
        message = parsed?.error || parsed?.message || message;
      } catch {
        // corps non-JSON ou déjà consommé : on garde le message générique
      }
    }

    return { data: null, error: message };
  }

  if (data && typeof data === 'object' && 'error' in data && data.error) {
    return { data: null, error: String((data as { error: unknown }).error) };
  }

  return { data: data as T, error: null };
};
