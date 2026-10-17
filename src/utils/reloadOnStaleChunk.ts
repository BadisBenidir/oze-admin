/**
 * Chargement à la demande d'un module (ex. jspdf pour les PDF) qui survit à
 * une mise en ligne : chaque déploiement renomme les fichiers (hash), un
 * onglet ouvert avant demande l'ancien, qui n'existe plus → « Failed to
 * fetch dynamically imported module ». Vite ne déclenche pas toujours
 * vite:preloadError dans ce cas (import sans dépendance), d'où ce filet :
 * la page se recharge une fois (garde de 10 s) pour récupérer la nouvelle
 * version, et l'utilisateur relance son action.
 */

const RELOAD_KEY = 'oze:chunk-reload';

const isStaleChunkError = (err: unknown) =>
  /dynamically imported module|Importing a module script failed|error loading dynamically imported module|not a valid JavaScript MIME type/i.test(
    err instanceof Error ? err.message : String(err)
  );

export async function importOrReload<T>(load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (err) {
    if (!isStaleChunkError(err)) throw err;
    let recentlyReloaded = false;
    try {
      recentlyReloaded = Date.now() - Number(sessionStorage.getItem(RELOAD_KEY) || 0) < 10_000;
      if (!recentlyReloaded) sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
    } catch {
      // stockage indisponible : on recharge quand même une fois
    }
    if (!recentlyReloaded) {
      window.location.reload();
      throw new Error('Une nouvelle version du site est disponible : la page se recharge, relance ensuite ton action.');
    }
    throw err;
  }
}
