import React from 'react';
import { navigationItems as defaultNavigationItems } from '../../config/navigation';
import { MenuItem } from '../../types';

interface VerticalSidebarProps {
  activeTab: string;
  activeSubTab: string;
  onSubTabChange: (subTab: string) => void;
  navigationItems?: MenuItem[];
}

export const VerticalSidebar: React.FC<VerticalSidebarProps> = ({
  activeTab,
  activeSubTab,
  onSubTabChange,
  navigationItems = defaultNavigationItems
}) => {
  const currentTab = navigationItems.find(item => item.id === activeTab);

  if (!currentTab || !currentTab.subItems) {
    return null;
  }

  // "Comptabilité & Finances" gère désormais sa propre navigation par
  // onglets et sa barre d'outils en interne (voir Accounting.tsx) — pas de
  // sous-navigation redondante dans la barre latérale pour cette section.
  if (currentTab.id === 'accounting') {
    return null;
  }

  return (
    <aside className="w-64 bg-gray-50 border-r border-gray-200 h-full overflow-y-auto">
      <div className="p-4">
        <div className="flex items-center space-x-2 mb-6">
          <currentTab.icon className="h-5 w-5 text-gray-700" />
          <h2 className="text-lg font-semibold text-gray-900">
            {currentTab.sidebarLabel || currentTab.label}
          </h2>
        </div>

        <nav className="space-y-1">
          {currentTab.subItems.map((subItem) => {
            const SubIconComponent = subItem.icon;
            const isActive = activeSubTab === subItem.id;

            return (
              <button
                key={subItem.id}
                onClick={() => onSubTabChange(subItem.id)}
                className={`
                  w-full flex items-center space-x-3 px-3 py-2.5 text-sm font-medium rounded-lg transition-all duration-150 text-left
                  ${isActive
                    ? 'bg-gray-900 text-white shadow-sm'
                    : 'text-gray-700 hover:bg-white hover:text-gray-900 hover:shadow-sm'
                  }
                `}
              >
                {SubIconComponent && <SubIconComponent className="h-4 w-4" />}
                <span className="flex-1">{subItem.label}</span>
                {!!subItem.badgeCount && (
                  <span className="flex-shrink-0 min-w-[1.25rem] h-5 px-1.5 rounded-full bg-red-600 text-white text-xs font-semibold flex items-center justify-center">
                    {subItem.badgeCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>
    </aside>
  );
};