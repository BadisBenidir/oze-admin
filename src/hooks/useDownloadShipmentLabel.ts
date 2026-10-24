import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { SUPABASE_CONFIG } from '../config/supabase.config';

interface DownloadResult {
  success: boolean;
  error?: string;
}

/** Téléphone / tablette : écran tactile, où le partage de fichier remplace l'ouverture d'un onglet. */
const isTouchDevice = () => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;

/** Partage du PDF SEUL (sans lien de page) — imprimer, AirDrop, WhatsApp… */
export const shareLabelFile = async (file: File): Promise<'shared' | 'cancelled' | 'needs_tap' | 'unsupported'> => {
  if (typeof navigator.share !== 'function' || !navigator.canShare?.({ files: [file] })) return 'unsupported';
  try {
    await navigator.share({ files: [file] });
    return 'shared';
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled';
    // Le navigateur exige un geste récent (le téléchargement a pris du temps).
    if (err instanceof DOMException && err.name === 'NotAllowedError') return 'needs_tap';
    return 'unsupported';
  }
};

/**
 * Le label_url renvoyé par Sendcloud (panel.sendcloud.sc/...) est un endpoint
 * d'API protégé par Basic Auth, pas une page de session panel — l'ouvrir
 * directement dans le navigateur échoue en 401 "not_authenticated" (aucun
 * header d'auth envoyé par un simple <a href>). On passe donc par l'edge
 * function sendcloud-download-label qui le récupère côté serveur avec les
 * clés API et retransmet le PDF.
 * Ordinateur : PDF ouvert dans un onglet (impression depuis le lecteur).
 * Téléphone / tablette : partage du FICHIER PDF seul (le partage d'un onglet
 * envoyait aussi le lien de la page, impossible à imprimer directement) ; si
 * le navigateur exige un nouveau geste, \`pendingFile\` est renseigné pour
 * afficher un bouton de partage (LabelShareModal).
 */
export const useDownloadShipmentLabel = () => {
  const [downloadingUrl, setDownloadingUrl] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  const download = async (labelUrl: string, fileName = 'bordereau.pdf'): Promise<DownloadResult> => {
    setDownloadingUrl(labelUrl);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return { success: false, error: 'Non authentifié' };

      const res = await fetch(`${SUPABASE_CONFIG.url}/functions/v1/sendcloud-download-label`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          apikey: SUPABASE_CONFIG.anonKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ label_url: labelUrl }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return { success: false, error: body?.error || `Erreur lors du téléchargement (${res.status})` };
      }

      const blob = await res.blob();

      if (isTouchDevice()) {
        const file = new File([blob], fileName, { type: 'application/pdf' });
        const outcome = await shareLabelFile(file);
        if (outcome === 'shared' || outcome === 'cancelled') return { success: true };
        if (outcome === 'needs_tap') {
          setPendingFile(file);
          return { success: true };
        }
      }

      const objectUrl = URL.createObjectURL(blob);
      window.open(objectUrl, '_blank');
      // Laisse le temps au nouvel onglet de charger le blob avant de le révoquer.
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Erreur réseau' };
    } finally {
      setDownloadingUrl(null);
    }
  };

  return { download, downloadingUrl, pendingFile, clearPendingFile: () => setPendingFile(null) };
};
