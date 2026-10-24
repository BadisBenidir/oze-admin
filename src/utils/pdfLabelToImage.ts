/**
 * Convertit la première page d'un bordereau PDF en image PNG (pdf.js, chargé
 * à la demande) — pour les applications d'imprimante thermique (Munbyn…) qui
 * acceptent mieux une image qu'un PDF partagé depuis une page web.
 * Largeur cible 1218 px : 10 cm de large à ~300 dpi, net à l'impression.
 */
export const pdfLabelToPng = async (pdf: Blob, fileName: string): Promise<File> => {
  const pdfjs = await import('pdfjs-dist');
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const doc = await pdfjs.getDocument({ data: new Uint8Array(await pdf.arrayBuffer()) }).promise;
  const page = await doc.getPage(1);
  const base = page.getViewport({ scale: 1 });
  const scale = 1218 / Math.min(base.width, base.height);
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas indisponible');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  await doc.destroy();

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Conversion en image impossible');
  return new File([blob], fileName.replace(/\.pdf$/i, '') + '.png', { type: 'image/png' });
};
