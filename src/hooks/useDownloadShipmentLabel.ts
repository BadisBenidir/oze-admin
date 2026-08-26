import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { SUPABASE_CONFIG } from '../config/supabase.config';

interface DownloadResult {
  success: boolean;
  error?: string;
}

/**
 * Le label_url renvoyé par Sendcloud (panel.sendcloud.sc/...) est un endpoint
 * d'API protégé par Basic Auth, pas une page de session panel — l'ouvrir
 * directement dans le navigateur échoue en 401 "not_authenticated" (aucun
 * header d'auth envoyé par un simple <a href>). On passe donc par l'edge
 * function sendcloud-download-label qui le récupère côté serveur avec les
 * clés API et retransmet le PDF, ouvert ici depuis un blob local.
 */
export const useDownloadShipmentLabel = () => {
  const [downloadingUrl, setDownloadingUrl] = useState<string | null>(null);

  const download = async (labelUrl: string): Promise<DownloadResult> => {
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

  return { download, downloadingUrl };
};
