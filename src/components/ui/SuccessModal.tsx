import React from 'react';
import { Modal } from './Modal';
import { Check, Package } from 'lucide-react';
import { ProductLabel } from '../products/ProductLabel';

interface SuccessModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  message: string;
  productCode?: string;
  /** Si fournie, affiche l'étiquette imprimable (QR Code + référence). */
  reference?: string | null;
  productName?: string;
  brandName?: string;
}

export const SuccessModal: React.FC<SuccessModalProps> = ({
  isOpen,
  onClose,
  title,
  message,
  productCode,
  reference,
  productName,
  brandName
}) => {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="">
      <div className="text-center py-4">
        {/* Icône de succès */}
        <div className="mx-auto flex items-center justify-center w-12 h-12 bg-green-100 rounded-full mb-4">
          <Check className="w-6 h-6 text-green-600" />
        </div>
        
        {/* Titre */}
        <h3 className="text-lg font-medium text-gray-900 mb-2">
          {title}
        </h3>
        
        {/* Message */}
        <p className="text-sm text-gray-600 mb-4">
          {message}
        </p>
        
        {/* Code produit si fourni */}
        {productCode && (
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-6">
            <div className="flex items-center justify-center space-x-2">
              <Package className="w-4 h-4 text-gray-500" />
              <span className="text-sm font-medium text-gray-700">Code produit :</span>
            </div>
            <div className="mt-1">
              <span className="font-mono text-lg font-semibold text-blue-600">
                {productCode}
              </span>
            </div>
          </div>
        )}

        {/* Étiquette imprimable (QR Code + référence) */}
        {reference && (
          <div className="mb-6">
            <ProductLabel name={productName || ''} reference={reference} brandName={brandName} />
          </div>
        )}

        {/* Bouton de fermeture */}
        <button
          onClick={onClose}
          className="w-full px-4 py-2 bg-green-600 text-white font-medium rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 transition-colors"
        >
          Parfait !
        </button>
      </div>
    </Modal>
  );
};