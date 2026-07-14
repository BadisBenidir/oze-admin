import React from 'react';
import { navigationItems as defaultNavigationItems } from '../../config/navigation';
import { MenuItem } from '../../types';

interface HorizontalNavProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  navigationItems?: MenuItem[];
  rightContent?: React.ReactNode;
}

export const HorizontalNav: React.FC<HorizontalNavProps> = ({
  activeTab,
  onTabChange,
  navigationItems = defaultNavigationItems,
  rightContent
}) => {
  return (
    <nav className="bg-gray-900 border-b border-gray-800">
      <div className="px-4 md:px-6">
        <div className="flex items-center justify-between">
          <div className="flex space-x-4 md:space-x-8 overflow-x-auto">
            {navigationItems.map((item) => {
              const IconComponent = item.icon as any;
              const isActive = activeTab === item.id;

              return (
                <button
                  key={item.id}
                  onClick={() => onTabChange(item.id)}
                  className={`
                    flex items-center space-x-2 px-3 md:px-4 py-4 text-sm font-medium border-b-2 transition-all duration-200 whitespace-nowrap
                    ${isActive
                      ? 'border-white text-white bg-gray-800'
                      : 'border-transparent text-gray-300 hover:text-white hover:border-gray-600'
                    }
                  `}
                >
                  <IconComponent className="h-4 w-4" />
                  <span className="hidden sm:inline">{item.label}</span>
                </button>
              );
            })}
          </div>
          {rightContent && <div className="flex items-center ml-auto pl-4">{rightContent}</div>}
        </div>
      </div>
    </nav>
  );
};