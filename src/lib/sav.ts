import { supabase } from './supabase';

/**
 * SAV OZË (0263 / 0264) : libellés, types et pièces jointes, partagés entre
 * l'onglet SAV de l'admin et « Mes demandes » / le chatbot de l'espace pro.
 */

export type SavStatus = 'new' | 'in_progress' | 'waiting_client' | 'resolved' | 'closed';
export type SavPriority = 'low' | 'normal' | 'high' | 'urgent';
export type SavCategory =
  | 'order_delivery'
  | 'parcel_damaged_lost'
  | 'authenticity'
  | 'return_refund'
  | 'payment'
  | 'subscription'
  | 'sourcing'
  | 'other';
export type SavDisputeDecision = 'accepted' | 'refused' | 'partial';
type BadgeVariant = 'default' | 'success' | 'successStrong' | 'warning' | 'danger' | 'info' | 'purple';

export const SAV_STATUS: Record<SavStatus, { label: string; variant: BadgeVariant }> = {
  new: { label: 'Nouveau', variant: 'info' },
  in_progress: { label: 'En cours', variant: 'purple' },
  waiting_client: { label: 'En attente client', variant: 'warning' },
  resolved: { label: 'Résolu', variant: 'success' },
  closed: { label: 'Fermé', variant: 'default' },
};

/** Libellés côté client : « En attente client » s'adresse à lui. */
export const SAV_STATUS_CLIENT: Record<SavStatus, { label: string; variant: BadgeVariant }> = {
  new: { label: 'Reçue', variant: 'info' },
  in_progress: { label: 'En cours', variant: 'purple' },
  waiting_client: { label: 'Réponse attendue', variant: 'warning' },
  resolved: { label: 'Résolue', variant: 'success' },
  closed: { label: 'Fermée', variant: 'default' },
};

export const SAV_PRIORITY: Record<SavPriority, { label: string; variant: BadgeVariant }> = {
  low: { label: 'Basse', variant: 'default' },
  normal: { label: 'Normale', variant: 'info' },
  high: { label: 'Haute', variant: 'warning' },
  urgent: { label: 'Urgente', variant: 'danger' },
};

export const SAV_CATEGORY: Record<SavCategory, string> = {
  order_delivery: 'Commande / livraison',
  parcel_damaged_lost: 'Colis endommagé ou perdu',
  authenticity: 'Authenticité',
  return_refund: 'Retour / remboursement',
  payment: 'Paiement',
  subscription: 'Abonnement Club B2B',
  sourcing: 'Sourcing sur mesure',
  other: 'Autre',
};

export const SAV_DECISION: Record<SavDisputeDecision, { label: string; variant: BadgeVariant }> = {
  accepted: { label: 'Accepté', variant: 'success' },
  refused: { label: 'Refusé', variant: 'danger' },
  partial: { label: 'Partiel', variant: 'warning' },
};

export interface SavAttachment {
  path: string;
  name: string;
  type: string;
  size: number;
}

export const SAV_BUCKET = 'sav-attachments';
export const SAV_MAX_FILES = 5;
export const SAV_MAX_FILE_BYTES = 8 * 1024 * 1024;

/** Réduit une photo à 1600 px (JPEG) avant envoi ; renvoie le fichier tel
 * quel si le navigateur ne sait pas la décoder (HEIC, PDF…). */
const shrinkImage = async (file: File): Promise<Blob> => {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 1.5 * 1024 * 1024) return file;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    return blob ?? file;
  } catch {
    return file;
  }
};

/**
 * Dépose les fichiers dans le bucket privé sav-attachments, dans le dossier
 * du compte revendeur (seul dossier autorisé côté client, 0263).
 * `folder` = reseller_id (l'équipe y ajoute « /equipe »).
 */
export const uploadSavAttachments = async (files: File[], folder: string): Promise<SavAttachment[]> => {
  if (files.length > SAV_MAX_FILES) throw new Error(`${SAV_MAX_FILES} fichiers maximum.`);
  const out: SavAttachment[] = [];
  for (const file of files) {
    const blob = await shrinkImage(file);
    if (blob.size > SAV_MAX_FILE_BYTES) throw new Error(`« ${file.name} » dépasse 8 Mo.`);
    const shrunk = blob !== file;
    const ext = shrunk ? 'jpg' : (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
    const path = `${folder}/${crypto.randomUUID()}.${ext}`;
    const type = shrunk ? 'image/jpeg' : file.type || 'application/octet-stream';
    const { error } = await supabase.storage.from(SAV_BUCKET).upload(path, blob, { contentType: type, upsert: false });
    if (error) throw new Error(`Envoi de « ${file.name} » impossible : ${error.message}`);
    out.push({ path, name: file.name, type, size: blob.size });
  }
  return out;
};

/** Liens temporaires (1 h) vers les pièces jointes, par chemin. */
export const signSavAttachments = async (paths: string[]): Promise<Record<string, string>> => {
  const unique = [...new Set(paths)];
  if (unique.length === 0) return {};
  const { data } = await supabase.storage.from(SAV_BUCKET).createSignedUrls(unique, 3600);
  const map: Record<string, string> = {};
  (data || []).forEach((d) => {
    if (d.path && d.signedUrl) map[d.path] = d.signedUrl;
  });
  return map;
};

export const formatSavDate = (iso: string | null | undefined, withTime = true) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
};
