import React, { useState } from 'react';
import { Menu, User, LogOut, ChevronDown, Building2, ShoppingBag, Wallet, Users } from 'lucide-react';
import { useResellerAuth } from '../../hooks/useResellerAuth';

interface ResellerHeaderProps {
  activeTab: string;
  onMenuToggle: () => void;
  onTabChange?: (tab: string) => void;
}

const TITLES: Record<string, string> = {
  catalog: 'Catalogue',
  'instant-buy': 'Achat Immédiat',
  'my-orders': 'Mes commandes',
  wallet: 'Mon Portefeuille',
  team: 'Mon équipe',
  auctions: 'Enchères',
  profile: 'Mon profil',
};

// Pages du compte, retirées de la barre de navigation (resellerNavigation.ts).
const ACCOUNT_LINKS = [
  { id: 'profile', label: 'Mon profil', icon: User },
  { id: 'my-orders', label: 'Mes commandes', icon: ShoppingBag },
  { id: 'wallet', label: 'Mon Portefeuille', icon: Wallet },
];

// Contact principal de l'entreprise uniquement (voir ResellerApp).
const TEAM_LINK = { id: 'team', label: 'Mon équipe', icon: Users };

export const ResellerHeader: React.FC<ResellerHeaderProps> = ({ activeTab, onMenuToggle, onTabChange }) => {
  const { profile, signOut } = useResellerAuth();
  // Identité masquée par l'admin (reseller_contacts.hide_identity, 0181) :
  // ni nom, ni email, ni entreprise dans l'en-tête (captures, partage d'écran).
  const hidden = Boolean(profile?.hide_identity);
  const displayName = hidden ? 'Mon compte' : profile ? `${profile.first_name} ${profile.last_name}` : 'Revendeur';
  const displayEmail = hidden ? '' : profile?.email;
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
          {profile && !profile.hide_identity && (
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
              <p className="font-medium text-gray-900">{displayName}</p>
              <p className="text-gray-500">{displayEmail}</p>
            </div>
            <ChevronDown className="h-4 w-4 text-gray-400" />
          </button>

          {showUserMenu && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowUserMenu(false)}></div>
              <div className="absolute right-0 mt-2 w-56 bg-white rounded-lg shadow-lg border border-gray-200 z-20">
                <div className="py-1">
                  <div className="px-4 py-3 border-b border-gray-100">
                    <p className="text-sm font-medium text-gray-900">{displayName}</p>
                    <p className="text-xs text-gray-500">{displayEmail}</p>
                  </div>
                  {onTabChange &&
                    (profile?.is_primary ? [...ACCOUNT_LINKS, TEAM_LINK] : ACCOUNT_LINKS).map(({ id, label, icon: Icon }) => (
                      <button
                        key={id}
                        onClick={() => {
                          onTabChange(id);
                          setShowUserMenu(false);
                        }}
                        className={`w-full flex items-center space-x-3 px-4 py-3 text-sm transition-colors ${
                          activeTab === id ? 'bg-gray-50 font-medium text-gray-900' : 'text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        <Icon className="h-4 w-4" />
                        <span>{label}</span>
                      </button>
                    ))}
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
