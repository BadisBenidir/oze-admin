import React from 'react';
import { Users } from './Users';

interface SettingsProps {
  activeSubTab: string;
}

export const Settings: React.FC<SettingsProps> = ({ activeSubTab }) => {
  switch (activeSubTab) {
    case 'users':
      return <Users />;
    case 'profile':
      return (
        <div className="p-6">
          <div className="bg-white rounded-lg border border-gray-100 shadow-sm p-8 text-center">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Profil</h3>
            <p className="text-gray-500">Configuration du profil administrateur en cours de développement</p>
          </div>
        </div>
      );
    case 'notifications':
      return (
        <div className="p-6">
          <div className="bg-white rounded-lg border border-gray-100 shadow-sm p-8 text-center">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Notifications</h3>
            <p className="text-gray-500">Paramètres de notifications en cours de développement</p>
          </div>
        </div>
      );
    case 'security':
      return (
        <div className="p-6">
          <div className="bg-white rounded-lg border border-gray-100 shadow-sm p-8 text-center">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Sécurité</h3>
            <p className="text-gray-500">Paramètres de sécurité en cours de développement</p>
          </div>
        </div>
      );
    default:
      return (
        <div className="p-6">
          <div className="bg-white rounded-lg border border-gray-100 shadow-sm p-8 text-center">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Paramètres</h3>
            <p className="text-gray-500">Sélectionnez une section dans le menu de gauche</p>
          </div>
        </div>
      );
  }
};