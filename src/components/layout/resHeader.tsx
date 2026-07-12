import React, { useState } from 'react';
import { Menu, User, LogOut, ChevronDown, Building2 } from 'lucide-react';
import { useResellerAuth } from '../../hooks/useResellerAuth';

interface ResellerHeaderProps {
  activeTab: string;
  onMenuToggle: () => void;
}

const TITLES: Record<string, string> = {
  catalog: 'Catalogue',
  'my-orders': 'Mes commandes',
  profile: 'Mon profil',
};

export const ResellerHeader: React.FC<ResellerHeaderProps> = ({ activeTab, onMenuToggle }) => {
  const { profile, signOut } = useResellerAuth();
  const [showUserMenu, setShowUserMenu] = useState(false);

  return (
    <header className="bg-white border-b border-gray-100 px-4 md:px-6 py-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center space-x-3 md:hidden">
            <button
              onClick={onMenuToggle}
              className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-lg transition-colors"
            >
              <Menu className="h-5 w-5" />
            </button>
          </div>
          <h1 className="text-xl md:text-2xl font-bold text-gray-900">{TITLES[activeTab] || 'Portail Revendeur'}</h1>
          {profile && (
            <p className="text-xs text-gray-500 flex items-center gap-1 mt-1">
              <Building2 className="h-3 w-3" /> {profile.company_name}
            </p>
          )}
        </div>

        <div className="relative">
          <button
            onClick={() => setShowUserMenu(!showUserMenu)}
            className="flex items-center space-x-3 p-2 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <div className="h-8 w-8 bg-gray-900 rounded-full flex items-center justify-center">
              <User className="h-4 w-4 text-white" />
            </div>
            <div className="text-sm hidden sm:block">
              <p className="font-medium text-gray-900">{profile ? `${profile.first_name} ${profile.last_name}` : 'Revendeur'}</p>
              <p className="text-gray-500">{profile?.email}</p>
            </div>
            <ChevronDown className="h-4 w-4 text-gray-400" />
          </button>

          {showUserMenu && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowUserMenu(false)}></div>
              <div className="absolute right-0 mt-2 w-56 bg-white rounded-lg shadow-lg border border-gray-200 z-20">
                <div className="py-1">
                  <div className="px-4 py-3 border-b border-gray-100">
                    <p className="text-sm font-medium text-gray-900">{profile ? `${profile.first_name} ${profile.last_name}` : 'Revendeur'}</p>
                    <p className="text-xs text-gray-500">{profile?.email}</p>
                  </div>
                  <button
                    onClick={() => {
                      signOut();
                      setShowUserMenu(false);
                    }}
                    className="w-full flex items-center space-x-3 px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    <LogOut className="h-4 w-4" />
                    <span>Se déconnecter</span>
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
};
