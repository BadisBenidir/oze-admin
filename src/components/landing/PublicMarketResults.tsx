import React, { useEffect } from 'react';
import { ArrowLeft } from 'lucide-react';
import { MarketResults } from '../pages/reseller/MarketResults';
import { LOGIN_URL } from './plans';
import logo from './assets/logo_oze_paris_b2b.png';

/**
 * b2b.ozeparis.com/resultats-de-ventes : page « Résultats de ventes » ouverte
 * aux visiteurs (get_market_results / get_market_result_detail publics, 0252),
 * avec un en-tête minimal vers la landing, la connexion et l'inscription.
 */
export const PublicMarketResults: React.FC = () => {
  useEffect(() => {
    document.title = 'Résultats de ventes | OZË Paris';
  }, []);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-40 border-b border-gray-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-3 px-4 py-3 md:px-6">
          <a href="/" className="flex items-center gap-3 text-sm text-gray-600 hover:text-gray-900">
            <ArrowLeft className="h-4 w-4" />
            <img src={logo} alt="OZË Paris" className="h-8 w-auto" />
          </a>
          <div className="flex items-center gap-2 sm:gap-4">
            <a href={LOGIN_URL} className="text-sm text-gray-700 hover:text-gray-900">
              Se connecter
            </a>
            <a href="/#tarifs" className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800">
              Rejoindre le Club
            </a>
          </div>
        </div>
      </header>
      <MarketResults />
    </div>
  );
};

export default PublicMarketResults;
