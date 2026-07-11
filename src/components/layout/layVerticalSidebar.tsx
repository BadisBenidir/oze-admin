import React from 'react';
import { navigationItems as defaultNavigationItems } from '../../config/navigation';
import { MenuItem } from '../../types';
import {
  TrendingUp,
  TrendingDown,
  BarChart3,
  Store,
  Globe,
  FileText,
  CreditCard
} from 'lucide-react';

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

  // Special handling for accounting section (groupé ENTRÉES / SORTIES, piloté par id)
  if (currentTab.id === 'accounting') {
    const subById = (id: string) => currentTab.subItems!.find((s) => s.id === id);

    const renderSub = (id: string, indent = false) => {
      const item = subById(id);
      if (!item) return null;
      const Icon = item.icon;
      const isActive = activeSubTab === id;
      return (
        <button
          key={id}
          onClick={() => onSubTabChange(id)}
          className={`
            w-full flex items-center space-x-3 ${indent ? 'px-6' : 'px-3'} py-2.5 text-sm font-medium rounded-lg transition-all duration-150
            ${isActive
              ? 'bg-gray-900 text-white shadow-sm'
              : 'text-gray-700 hover:bg-white hover:text-gray-900 hover:shadow-sm'
            }
          `}
        >
          {Icon && <Icon className="h-4 w-4" />}
          <span>{item.label}</span>
        </button>
      );
    };

    return (
      <aside className="w-64 bg-gray-50 border-r border-gray-200 h-full overflow-y-auto">
        <div className="p-4">
          <div className="flex items-center space-x-2 mb-6">
            <currentTab.icon className="h-5 w-5 text-gray-700" />
            <h2 className="text-lg font-semibold text-gray-900">{currentTab.label}</h2>
          </div>

          <nav className="space-y-1">
            {renderSub('dashboard')}

            {/* ENTRÉES */}
            <div className="pt-4">
              <div className="flex items-center space-x-2 px-3 py-2 mb-2">
                <TrendingUp className="h-4 w-4 text-green-600" />
                <span className="text-xs font-semibold text-green-600 uppercase tracking-wider">ENTRÉES</span>
              </div>
              {renderSub('ventes-ligne', true)}
            </div>

            {/* SORTIES */}
            <div className="pt-4">
              <div className="flex items-center space-x-2 px-3 py-2 mb-2">
                <TrendingDown className="h-4 w-4 text-red-600" />
                <span className="text-xs font-semibold text-red-600 uppercase tracking-wider">SORTIES</span>
              </div>
              {renderSub('depenses', true)}
              {renderSub('factures', true)}
              {renderSub('paiements', true)}
              {renderSub('rapports-financiers', true)}
            </div>
          </nav>
        </div>
      </aside>
    );
  }

  return (
    <aside className="w-64 bg-gray-50 border-r border-gray-200 h-full overflow-y-auto">
      <div className="p-4">
        <div className="flex items-center space-x-2 mb-6">
          <currentTab.icon className="h-5 w-5 text-gray-700" />
          <h2 className="text-lg font-semibold text-gray-900">
            {currentTab.label}
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
                <span>{subItem.label}</span>
              </button>
            );
          })}
        </nav>
      </div>
    </aside>
  );
};