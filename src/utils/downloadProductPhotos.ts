import { zipSync } from 'fflate';

/**
 * Télécharge toutes les photos d'un article en un seul fichier ZIP :
 * photos principales numérotées (01, 02…) et photos des défauts dans un
 * sous-dossier « defauts ». Les photos sont lues depuis le stockage public
 * Supabase (CORS ouvert) puis zippées dans le navigateur, sans recompression
 * (les JPEG/PNG sont déjà compressés).
 */

const extensionFor = (url: string, contentType: string | null): string => {
  const fromType = contentType?.split('/')[1]?.split(';')[0];
  if (fromType && ['jpeg', 'jpg', 'png', 'webp', 'gif', 'heic'].includes(fromType)) return fromType === 'jpeg' ? 'jpg' : fromType;
  const fromUrl = url.split('?')[0].split('.').pop()?.toLowerCase();
  return fromUrl && fromUrl.length <= 4 ? fromUrl : 'jpg';
};

const safeName = (text: string) =>
  text.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'article';

export async function downloadProductPhotos(params: {
  images: string[];
  defectImages?: string[];
  baseName: string;
  onProgress?: (done: number, total: number) => void;
}): Promise<{ downloaded: number; failed: number }> {
  const entries = [
    ...params.images.map((url, i) => ({ url, path: `${String(i + 1).padStart(2, '0')}` })),
    ...(params.defectImages || []).map((url, i) => ({ url, path: `defauts/defaut-${String(i + 1).padStart(2, '0')}` })),
  ];
  const files: Record<string, Uint8Array> = {};
  let done = 0;
  let failed = 0;

  await Promise.all(
    entries.map(async (entry) => {
      try {
        const res = await fetch(entry.url);
        if (!res.ok) throw new Error(String(res.status));
        const data = new Uint8Array(await res.arrayBuffer());
        files[`${entry.path}.${extensionFor(entry.url, res.headers.get('content-type'))}`] = data;
      } catch {
        failed += 1;
      } finally {
        done += 1;
        params.onProgress?.(done, entries.length);
      }
    }),
  );

  const count = Object.keys(files).length;
  if (count === 0) return { downloaded: 0, failed };

  // level 0 : simple archivage, les images sont déjà compressées.
  const zip = zipSync(files, { level: 0 });
  const blob = new Blob([zip], { type: 'application/zip' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${safeName(params.baseName)}-photos.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  return { downloaded: count, failed };
}
