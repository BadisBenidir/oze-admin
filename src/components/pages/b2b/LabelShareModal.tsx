import React from 'react';
import { createPortal } from 'react-dom';
import { FileDown, Share2, X } from 'lucide-react';
import { shareLabelFile } from '../../../hooks/useDownloadShipmentLabel';

/**
 * Bordereau prêt (téléphone / tablette) quand le navigateur exige un nouveau
 * toucher avant le partage : partage du PDF seul, ou ouverture en repli.
 */
export const LabelShareModal: React.FC<{ file: File | null; onClose: () => void }> = ({ file, onClose }) => {
  if (!file) return null;

  const share = async () => {
    const outcome = await shareLabelFile(file);
    if (outcome === 'unsupported' || outcome === 'needs_tap') open();
    else onClose();
  };

  const open = () => {
    const url = URL.createObjectURL(file);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    onClose();
  };

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
          <button
            type="button"
            onClick={share}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-gray-900 py-3 text-sm font-semibold text-white hover:bg-gray-800"
          >
            <Share2 className="h-4 w-4" /> Partager / imprimer le PDF
          </button>
          <button
            type="button"
            onClick={open}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-gray-100 py-3 text-sm font-medium text-gray-800 hover:bg-gray-200"
          >
            <FileDown className="h-4 w-4" /> Ouvrir le PDF
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default LabelShareModal;
