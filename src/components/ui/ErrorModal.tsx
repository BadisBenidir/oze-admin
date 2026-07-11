import React from 'react';
import { Modal } from './Modal';
import { AlertCircle } from 'lucide-react';

interface ErrorModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  message: string;
}

export const ErrorModal: React.FC<ErrorModalProps> = ({
  isOpen,
  onClose,
  title,
  message
}) => {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="">
      <div className="text-center py-4">
        {/* Icône d'erreur */}
        <div className="mx-auto flex items-center justify-center w-12 h-12 bg-red-100 rounded-full mb-4">
          <AlertCircle className="w-6 h-6 text-red-600" />
        </div>
        
        {/* Titre */}
        <h3 className="text-lg font-medium text-gray-900 mb-2">
          {title}
        </h3>
        
        {/* Message d'erreur */}
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
          <p className="text-sm text-red-700">
            {message}
          </p>
        </div>
        
        {/* Bouton de fermeture */}
        <button
          onClick={onClose}
          className="w-full px-4 py-2 bg-red-600 text-white font-medium rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 transition-colors"
        >
          Compris
        </button>
      </div>
    </Modal>
  );
};