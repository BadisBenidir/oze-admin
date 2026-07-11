import React from 'react';
import { useState } from 'react';
import { Header } from "./layHeader";
import { HorizontalNav } from "./layHorizontalNav";
import { VerticalSidebar } from "./layVerticalSidebar";
import { navigationItems as defaultNavigationItems } from '../../config/navigation';
import { MenuItem } from '../../types';

interface MainLayoutProps {
  children: React.ReactNode;
  activeTab: string;
  activeSubTab: string;
  onTabChange: (tab: string) => void;
  onSubTabChange: (subTab: string) => void;
  navigationItems?: MenuItem[];
  renderHeader?: (props: { activeTab: string; onMenuToggle: () => void }) => React.ReactNode;
}

export const MainLayout: React.FC<MainLayoutProps> = ({
  children,
  activeTab,
  activeSubTab,
  onTabChange,
  onSubTabChange,
  navigationItems = defaultNavigationItems,
  renderHeader,
}) => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const toggleMobileMenu = () => {
    setIsMobileMenuOpen(!isMobileMenuOpen);
  };

  const closeMobileMenu = () => {
    setIsMobileMenuOpen(false);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {renderHeader
        ? renderHeader({ activeTab, onMenuToggle: toggleMobileMenu })
        : <Header activeTab={activeTab} onMenuToggle={toggleMobileMenu} />}
      
      {/* Mobile Menu Overlay */}
      {isMobileMenuOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="fixed inset-0 bg-black bg-opacity-50" onClick={closeMobileMenu}></div>
          <div className="fixed top-0 left-0 w-64 h-full bg-white shadow-lg">
            <div className="p-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">Menu</h2>
            </div>
            <div className="py-4">
              {/* Mobile Navigation */}
              <nav className="space-y-1 px-4">
                {navigationItems.map((item) => {
                  const IconComponent = item.icon;
                  const isActive = activeTab === item.id;
                  
                  return (
                    <div key={item.id}>
                      <button
                        onClick={() => {
                          onTabChange(item.id);
                          if (!item.subItems || item.subItems.length === 0) {
                            closeMobileMenu();
                          }
                        }}
                        className={`
                          w-full flex items-center space-x-3 px-3 py-3 text-sm font-medium rounded-lg transition-all duration-200
                          ${isActive 
                            ? 'bg-gray-900 text-white' 
                            : 'text-gray-700 hover:bg-gray-100'
                          }
                        `}
                      >
                        <IconComponent className="h-5 w-5" />
                        <span>{item.label}</span>
                      </button>
                      
                      {/* Sub-menu items */}
                      {isActive && item.subItems && item.subItems.length > 0 && (
                        <div className="ml-6 mt-2 space-y-1">
                          {item.subItems.map((subItem) => {
                            const SubIconComponent = subItem.icon;
                            const isSubActive = activeSubTab === subItem.id;
                            
                            return (
                              <button
                                key={subItem.id}
                                onClick={() => {
                                  onSubTabChange(subItem.id);
                                  closeMobileMenu();
                                }}
                                className={`
                                  w-full flex items-center space-x-3 px-3 py-2 text-sm font-medium rounded-lg transition-all duration-200
                                  ${isSubActive 
                                    ? 'bg-gray-800 text-white' 
                                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                                  }
                                `}
                              >
                                {SubIconComponent && <SubIconComponent className="h-4 w-4" />}
                                <span>{subItem.label}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </nav>
            </div>
          </div>
        </div>
      )}
      
      <div className="hidden md:block">
        <HorizontalNav activeTab={activeTab} onTabChange={onTabChange} navigationItems={navigationItems} />
      </div>

      <div className="md:flex md:h-[calc(100vh-140px)]">
        <div className="hidden md:block">
          <VerticalSidebar
            activeTab={activeTab}
            activeSubTab={activeSubTab}
            onSubTabChange={onSubTabChange}
            navigationItems={navigationItems}
          />
        </div>
        
        <main className="flex-1 md:overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
};