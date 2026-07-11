import React, { useState } from 'react';
import { Bell, User, Menu, LogOut, ChevronDown } from 'lucide-react';
import { useAdminAuth } from '../../hooks/useAdminAuth';

interface HeaderProps {
  activeTab: string;
  onMenuToggle: () => void;
}

export const Header: React.FC<HeaderProps> = ({ activeTab, onMenuToggle }) => {
  const { profile, signOut } = useAdminAuth()
  const [showUserMenu, setShowUserMenu] = useState(false)
  const getPageTitle = (tab: string) => {
    const titles = {
      dashboard: 'Dashboard',
      products: 'Gestion des Produits',
      orders: 'Gestion des Commandes',
      customers: 'Gestion des Clients',
      accounting: 'Comptabilité & Finances',
      analytics: 'Analytics & Rapports',
      settings: 'Paramètres',
    };
    return titles[tab as keyof typeof titles] || 'Admin Panel';
  };

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
          <h1 className="text-xl md:text-2xl font-bold text-gray-900">
            {getPageTitle(activeTab)}
          </h1>
        </div>
        
        <div className="flex items-center space-x-4">
          {/* Notifications */}
          <button className="relative p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-lg transition-colors">
            <Bell className="h-5 w-5" />
            <span className="absolute top-1 right-1 h-2 w-2 bg-red-500 rounded-full"></span>
          </button>

          {/* User Profile Desktop */}
          <div className="hidden sm:block relative">
            <button
              onClick={() => setShowUserMenu(!showUserMenu)}
              className="flex items-center space-x-3 p-2 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <div className="h-8 w-8 bg-gray-900 rounded-full flex items-center justify-center">
                <User className="h-4 w-4 text-white" />
              </div>
              <div className="text-sm">
                <p className="font-medium text-gray-900">
                  {profile ? `${profile.first_name} ${profile.last_name}` : 'Administrateur'}
                </p>
                <p className="text-gray-500">{profile?.email || 'admin@ozeparis.com'}</p>
              </div>
              <ChevronDown className="h-4 w-4 text-gray-400" />
            </button>

            {/* Dropdown Menu */}
            {showUserMenu && (
              <>
                <div 
                  className="fixed inset-0 z-10" 
                  onClick={() => setShowUserMenu(false)}
                ></div>
                <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border border-gray-200 z-20">
                  <div className="py-1">
                    <div className="px-4 py-3 border-b border-gray-100">
                      <p className="text-sm font-medium text-gray-900">
                        {profile ? `${profile.first_name} ${profile.last_name}` : 'Administrateur'}
                      </p>
                      <p className="text-xs text-gray-500">{profile?.email}</p>
                      <p className="text-xs text-blue-600 mt-1">Rôle: {profile?.role}</p>
                    </div>
                    <button
                      onClick={() => {
                        signOut()
                        setShowUserMenu(false)
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
          
          {/* Mobile User Profile */}
          <div className="sm:hidden">
            <button
              onClick={() => setShowUserMenu(!showUserMenu)}
              className="relative"
            >
              <div className="h-8 w-8 bg-gray-900 rounded-full flex items-center justify-center">
                <User className="h-4 w-4 text-white" />
              </div>
            </button>

            {/* Mobile Dropdown */}
            {showUserMenu && (
              <>
                <div 
                  className="fixed inset-0 z-10" 
                  onClick={() => setShowUserMenu(false)}
                ></div>
                <div className="absolute right-0 mt-2 w-64 bg-white rounded-lg shadow-lg border border-gray-200 z-20">
                  <div className="py-1">
                    <div className="px-4 py-3 border-b border-gray-100">
                      <p className="text-sm font-medium text-gray-900">
                        {profile ? `${profile.first_name} ${profile.last_name}` : 'Administrateur'}
                      </p>
                      <p className="text-xs text-gray-500">{profile?.email}</p>
                      <p className="text-xs text-blue-600 mt-1">Rôle: {profile?.role}</p>
                    </div>
                    <button
                      onClick={() => {
                        signOut()
                        setShowUserMenu(false)
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
      </div>
    </header>
  );
};