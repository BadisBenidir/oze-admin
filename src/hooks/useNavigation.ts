import { useState } from 'react';

export const useNavigation = () => {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [activeSubTab, setActiveSubTab] = useState('');

  const navigateTo = (tab: string, subTab?: string) => {
    setActiveTab(tab);
    setActiveSubTab(subTab || '');
  };

  return {
    activeTab,
    activeSubTab,
    navigateTo,
  };
};