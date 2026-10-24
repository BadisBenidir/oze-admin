import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, FileDown, Image as ImageIcon, Loader2, Share2, X } from 'lucide-react';
import { shareLabelFile } from '../../../hooks/useDownloadShipmentLabel';
import { pdfLabelToPng } from '../../../utils/pdfLabelToImage';

/**
 * Bordereau prêt (téléphone / tablette) : plusieurs façons de l'envoyer vers
 * l'application de l'imprimante thermique (Munbyn…), qui n'accepte pas
 * toujours un PDF partagé depuis une page web :
 *   - Enregistrer le PDF (Fichiers / Téléchargements), puis l'ouvrir dans
 *     l'application de l'imprimante — même chemin qu'un PDF reçu par mail ;
 *   - Partager en image (PNG haute définition, format étiquette) ;
 *   - Partager le PDF ; Ouvrir le PDF.
 */
export const LabelShareModal: React.FC<{ file: File | null; onClose: () => void }> = ({ file, onClose }) => {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  if (!file) return null;

  const downloadFile = (f: File) => {
    const url = URL.createObjectURL(f);
    const a = document.createElement('a');
    a.href = url;
    a.download = f.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const open = () => {
    const url = URL.createObjectURL(file);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    onClose();
  };

  const save = () => {
    downloadFile(file);
    setMessage("PDF enregistré : ouvre-le depuis Fichiers / Téléchargements, puis « Partager » → ton application d'imprimante.");
  };

  const sharePdf = async () => {
    setMessage(null);
    const outcome = await shareLabelFile(file);
    if (outcome === 'unsupported' || outcome === 'needs_tap') setMessage('Partage du PDF non pris en charge ici : utilise « Enregistrer le PDF ».');
  };

  const shareImage = async () => {
    setMessage(null);
    setBusy('image');
    try {
      const png = await pdfLabelToPng(file, file.name);
      const outcome = await shareLabelFile(png);
      if (outcome === 'unsupported' || outcome === 'needs_tap') {
        downloadFile(png);
        setMessage("Image enregistrée : ouvre-la depuis tes photos / téléchargements dans ton application d'imprimante.");
      }
    } catch (err) {
      setMessage(`Conversion en image impossible : ${err instanceof Error ? err.message : 'erreur inconnue'}`);
    } finally {
      setBusy(null);
    }
  };

  const btn = 'flex w-full items-center justify-center gap-2 rounded-lg py-3 text-sm font-medium disabled:opacity-50';

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-end justify-center p-4 sm:items-center" onClick={(e) => e.stopPropagation()}>
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-sm rounded-xl bg-white p-5 shadow-xl">
        <button type="button" onClick={onClose} className="absolute right-3 top-3 rounded-lg p-1 text-gray-400 hover:text-gray-600">
          <X className="h-5 w-5" />
        </button>
        <p className="text-base font-semibold text-gray-900">Bordereau prêt</p>
        <p className="mt-1 text-sm text-gray-500">{file.name}</p>
        <div className="mt-4 space-y-2">
          <button type="button" onClick={save} className={`${btn} bg-gray-900 font-semibold text-white hover:bg-gray-800`}>
            <Download className="h-4 w-4" /> Enregistrer le PDF
          </button>
          <button type="button" onClick={shareImage} disabled={busy !== null} className={`${btn} bg-gray-100 text-gray-800 hover:bg-gray-200`}>
            {busy === 'image' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />} Partager en image (imprimante thermique)
          </button>
          <button type="button" onClick={sharePdf} disabled={busy !== null} className={`${btn} bg-gray-100 text-gray-800 hover:bg-gray-200`}>
            <Share2 className="h-4 w-4" /> Partager le PDF
          </button>
          <button type="button" onClick={open} className={`${btn} text-gray-600 hover:bg-gray-50`}>
            <FileDown className="h-4 w-4" /> Ouvrir le PDF
          </button>
        </div>
        {message && <p className="mt-3 text-xs text-gray-600">{message}</p>}
      </div>
    </div>,
    document.body
  );
};

export default LabelShareModal;
