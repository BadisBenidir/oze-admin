import React, { useMemo, useState } from 'react';
import { Card, CardContent } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Search, SlidersHorizontal, X, ImageOff, RotateCcw } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types & mock data (données fictives — à remplacer par un hook Supabase une
// fois le visuel validé, sur le modèle de useB2BCatalog côté portail revendeur)
// ---------------------------------------------------------------------------

type LotCondition = 'SA' | 'A' | 'AB' | 'B';

interface B2BLot {
  id: string;
  reference: string;
  name: string;
  type: string;
  brand: string;
  condition: LotCondition;
  price: number;
  image: string | null;
}

const CONDITION_VARIANTS: Record<LotCondition, 'success' | 'info' | 'warning' | 'default'> = {
  SA: 'success',
  A: 'success',
  AB: 'info',
  B: 'warning',
};

const CONDITION_ORDER: LotCondition[] = ['SA', 'A', 'AB', 'B'];

const PRICE_BRACKETS: { id: string; label: string; min: number; max: number | null }[] = [
  { id: 'all', label: 'Tous les prix', min: 0, max: null },
  { id: 'b0', label: 'Moins de 500 €', min: 0, max: 500 },
  { id: 'b1', label: '500 € – 1 500 €', min: 500, max: 1500 },
  { id: 'b2', label: '1 500 € – 3 000 €', min: 1500, max: 3000 },
  { id: 'b3', label: 'Plus de 3 000 €', min: 3000, max: null },
];

const MOCK_LOTS: B2BLot[] = [
  { id: '1', reference: 'OZ-LV-L001', name: 'Speedy Bandoulière 25', type: 'Sacs à main', brand: 'Louis Vuitton', condition: 'SA', price: 1450, image: null },
  { id: '2', reference: 'OZ-CH-L002', name: 'Classic Flap Medium', type: 'Sacs à main', brand: 'Chanel', condition: 'A', price: 3200, image: null },
  { id: '3', reference: 'OZ-HE-L003', name: 'Evelyne 33 Clemence', type: 'Sacs à main', brand: 'Hermès', condition: 'SA', price: 3900, image: null },
  { id: '4', reference: 'OZ-GU-L004', name: 'Marmont Backpack', type: 'Sacs à dos', brand: 'Gucci', condition: 'AB', price: 780, image: null },
  { id: '5', reference: 'OZ-DI-L005', name: 'Saddle Bag', type: 'Sacs à main', brand: 'Dior', condition: 'A', price: 1650, image: null },
  { id: '6', reference: 'OZ-LV-L006', name: 'Ceinture Initiales', type: 'Ceintures', brand: 'Louis Vuitton', condition: 'B', price: 220, image: null },
  { id: '7', reference: 'OZ-CH-L007', name: 'Portefeuille Timeless', type: 'Portefeuilles', brand: 'Chanel', condition: 'AB', price: 590, image: null },
  { id: '8', reference: 'OZ-HE-L008', name: 'Carré Twilly', type: 'Accessoires', brand: 'Hermès', condition: 'SA', price: 180, image: null },
  { id: '9', reference: 'OZ-GU-L009', name: 'Sac Bandoulière Ophidia', type: 'Sacs à main', brand: 'Gucci', condition: 'A', price: 990, image: null },
  { id: '10', reference: 'OZ-DI-L010', name: 'Book Tote Small', type: 'Sacs à main', brand: 'Dior', condition: 'B', price: 1350, image: null },
  { id: '11', reference: 'OZ-LV-L011', name: 'Sac à dos Christopher', type: 'Sacs à dos', brand: 'Louis Vuitton', condition: 'AB', price: 1890, image: null },
  { id: '12', reference: 'OZ-CH-L012', name: 'Boy Bag Medium', type: 'Sacs à main', brand: 'Chanel', condition: 'SA', price: 4200, image: null },
  { id: '13', reference: 'OZ-HE-L013', name: 'Ceinture H Réversible', type: 'Ceintures', brand: 'Hermès', condition: 'A', price: 460, image: null },
  { id: '14', reference: 'OZ-GU-L014', name: 'Portefeuille GG Marmont', type: 'Portefeuilles', brand: 'Gucci', condition: 'B', price: 310, image: null },
  { id: '15', reference: 'OZ-DI-L015', name: 'Lunettes DiorSoLight', type: 'Accessoires', brand: 'Dior', condition: 'AB', price: 210, image: null },
  { id: '16', reference: 'OZ-LV-L016', name: 'Pochette Félicie', type: 'Portefeuilles', brand: 'Louis Vuitton', condition: 'SA', price: 640, image: null },
];

const TYPE_OPTIONS = Array.from(new Set(MOCK_LOTS.map((lot) => lot.type))).sort();
const BRAND_OPTIONS = Array.from(new Set(MOCK_LOTS.map((lot) => lot.brand))).sort();

// ---------------------------------------------------------------------------
// Composant principal
// ---------------------------------------------------------------------------

export const B2BPortal: React.FC = () => {
  const [search, setSearch] = useState('');
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [selectedBrands, setSelectedBrands] = useState<string[]>([]);
  const [selectedConditions, setSelectedConditions] = useState<LotCondition[]>([]);
  const [priceBracketId, setPriceBracketId] = useState('all');
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  const toggle = <T,>(value: T, list: T[], setList: (v: T[]) => void) => {
    setList(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  };

  const priceBracket = PRICE_BRACKETS.find((b) => b.id === priceBracketId) ?? PRICE_BRACKETS[0];

  const filteredLots = useMemo(() => {
    const query = search.trim().toLowerCase();
    return MOCK_LOTS.filter((lot) => {
      if (query && !lot.name.toLowerCase().includes(query) && !lot.reference.toLowerCase().includes(query)) {
        return false;
      }
      if (selectedTypes.length > 0 && !selectedTypes.includes(lot.type)) return false;
      if (selectedBrands.length > 0 && !selectedBrands.includes(lot.brand)) return false;
      if (selectedConditions.length > 0 && !selectedConditions.includes(lot.condition)) return false;
      if (lot.price < priceBracket.min) return false;
      if (priceBracket.max !== null && lot.price > priceBracket.max) return false;
      return true;
    });
  }, [search, selectedTypes, selectedBrands, selectedConditions, priceBracket]);

  const activeFilterCount =
    selectedTypes.length + selectedBrands.length + selectedConditions.length + (priceBracketId !== 'all' ? 1 : 0);

  const resetFilters = () => {
    setSelectedTypes([]);
    setSelectedBrands([]);
    setSelectedConditions([]);
    setPriceBracketId('all');
  };

  return (
    <div className="p-4 md:p-6">
      <div className="mb-6 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Portail B2B</h3>
          <p className="text-sm text-gray-500">Catalogue de lots — enchères &amp; grossistes</p>
        </div>
        <button
          onClick={() => setMobileFiltersOpen(true)}
          className="lg:hidden relative flex items-center gap-2 px-4 py-2 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          <SlidersHorizontal className="h-4 w-4" />
          Filtres
          {activeFilterCount > 0 && (
            <span className="absolute -top-2 -right-2 h-5 w-5 flex items-center justify-center bg-gray-900 text-white text-[11px] rounded-full">
              {activeFilterCount}
            </span>
          )}
        </button>
      </div>

      {/* Barre de recherche */}
      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <input
          type="text"
          placeholder="Rechercher par nom ou référence..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg focus:border-gray-400 focus:outline-none text-sm"
        />
      </div>

      <div className="flex gap-6 items-start">
        {/* Sidebar filtres — desktop */}
        <aside className="hidden lg:block w-64 shrink-0 sticky top-6">
          <FiltersPanel
            selectedTypes={selectedTypes}
            selectedBrands={selectedBrands}
            selectedConditions={selectedConditions}
            priceBracketId={priceBracketId}
            onToggleType={(t) => toggle(t, selectedTypes, setSelectedTypes)}
            onToggleBrand={(b) => toggle(b, selectedBrands, setSelectedBrands)}
            onToggleCondition={(c) => toggle(c, selectedConditions, setSelectedConditions)}
            onSelectPriceBracket={setPriceBracketId}
            onReset={resetFilters}
            activeFilterCount={activeFilterCount}
          />
        </aside>

        {/* Grille de résultats */}
        <div className="flex-1 min-w-0">
          <p className="text-sm text-gray-500 mb-4">
            {filteredLots.length} lot{filteredLots.length !== 1 ? 's' : ''} trouvé{filteredLots.length !== 1 ? 's' : ''}
          </p>

          {filteredLots.length === 0 ? (
            <div className="text-center py-16">
              <ImageOff className="h-12 w-12 text-gray-300 mx-auto mb-4" />
              <h4 className="text-base font-medium text-gray-900 mb-1">Aucun lot ne correspond à ces critères</h4>
              <p className="text-sm text-gray-500 mb-4">Essayez d'élargir votre recherche ou vos filtres.</p>
              <button
                onClick={resetFilters}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50"
              >
                <RotateCcw className="h-4 w-4" />
                Réinitialiser les filtres
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-4">
              {filteredLots.map((lot) => (
                <LotCard key={lot.id} lot={lot} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Panneau filtres — mobile (overlay) */}
      {mobileFiltersOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileFiltersOpen(false)} />
          <div className="absolute right-0 top-0 h-full w-full max-w-sm bg-white shadow-xl flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-gray-100">
              <h4 className="font-semibold text-gray-900">Filtres</h4>
              <button onClick={() => setMobileFiltersOpen(false)} className="p-1 text-gray-500 hover:text-gray-800">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <FiltersPanel
                selectedTypes={selectedTypes}
                selectedBrands={selectedBrands}
                selectedConditions={selectedConditions}
                priceBracketId={priceBracketId}
                onToggleType={(t) => toggle(t, selectedTypes, setSelectedTypes)}
                onToggleBrand={(b) => toggle(b, selectedBrands, setSelectedBrands)}
                onToggleCondition={(c) => toggle(c, selectedConditions, setSelectedConditions)}
                onSelectPriceBracket={setPriceBracketId}
                onReset={resetFilters}
                activeFilterCount={activeFilterCount}
              />
            </div>
            <div className="p-4 border-t border-gray-100">
              <button
                onClick={() => setMobileFiltersOpen(false)}
                className="w-full py-2.5 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800"
              >
                Voir {filteredLots.length} résultat{filteredLots.length !== 1 ? 's' : ''}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Sous-composants
// ---------------------------------------------------------------------------

interface FiltersPanelProps {
  selectedTypes: string[];
  selectedBrands: string[];
  selectedConditions: LotCondition[];
  priceBracketId: string;
  onToggleType: (type: string) => void;
  onToggleBrand: (brand: string) => void;
  onToggleCondition: (condition: LotCondition) => void;
  onSelectPriceBracket: (id: string) => void;
  onReset: () => void;
  activeFilterCount: number;
}

const FiltersPanel: React.FC<FiltersPanelProps> = ({
  selectedTypes,
  selectedBrands,
  selectedConditions,
  priceBracketId,
  onToggleType,
  onToggleBrand,
  onToggleCondition,
  onSelectPriceBracket,
  onReset,
  activeFilterCount,
}) => {
  return (
    <div className="space-y-6">
      {activeFilterCount > 0 && (
        <button
          onClick={onReset}
          className="flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-800"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Réinitialiser ({activeFilterCount})
        </button>
      )}

      <FilterGroup title="Type">
        {TYPE_OPTIONS.map((type) => (
          <CheckboxRow key={type} label={type} checked={selectedTypes.includes(type)} onChange={() => onToggleType(type)} />
        ))}
      </FilterGroup>

      <FilterGroup title="Marque">
        {BRAND_OPTIONS.map((brand) => (
          <CheckboxRow key={brand} label={brand} checked={selectedBrands.includes(brand)} onChange={() => onToggleBrand(brand)} />
        ))}
      </FilterGroup>

      <FilterGroup title="État">
        <div className="flex flex-wrap gap-2">
          {CONDITION_ORDER.map((condition) => {
            const active = selectedConditions.includes(condition);
            return (
              <button
                key={condition}
                onClick={() => onToggleCondition(condition)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                  active
                    ? 'bg-gray-900 text-white border-gray-900'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                }`}
              >
                {condition}
              </button>
            );
          })}
        </div>
      </FilterGroup>

      <FilterGroup title="Prix">
        <div className="space-y-1">
          {PRICE_BRACKETS.map((bracket) => (
            <label key={bracket.id} className="flex items-center gap-2 py-1 cursor-pointer text-sm text-gray-700">
              <input
                type="radio"
                name="price-bracket"
                checked={priceBracketId === bracket.id}
                onChange={() => onSelectPriceBracket(bracket.id)}
                className="h-3.5 w-3.5 text-gray-900 focus:ring-gray-400"
              />
              {bracket.label}
            </label>
          ))}
        </div>
      </FilterGroup>
    </div>
  );
};

const FilterGroup: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div>
    <h5 className="text-xs font-semibold text-gray-900 uppercase tracking-wide mb-3">{title}</h5>
    {children}
  </div>
);

const CheckboxRow: React.FC<{ label: string; checked: boolean; onChange: () => void }> = ({ label, checked, onChange }) => (
  <label className="flex items-center gap-2 py-1 cursor-pointer text-sm text-gray-700">
    <input
      type="checkbox"
      checked={checked}
      onChange={onChange}
      className="h-3.5 w-3.5 rounded border-gray-300 text-gray-900 focus:ring-gray-400"
    />
    {label}
  </label>
);

const LotCard: React.FC<{ lot: B2BLot }> = ({ lot }) => (
  <Card hover className="overflow-hidden flex flex-col cursor-pointer">
    <div className="h-40 bg-gray-100 flex items-center justify-center overflow-hidden">
      {lot.image ? (
        <img src={lot.image} alt={lot.name} className="w-full h-full object-cover" />
      ) : (
        <ImageOff className="h-8 w-8 text-gray-300" />
      )}
    </div>
    <CardContent className="p-3 flex-1 flex flex-col">
      <p className="text-[11px] text-gray-400 font-mono mb-1">{lot.reference}</p>
      <p className="text-sm font-medium text-gray-900 line-clamp-2 mb-1">{lot.name}</p>
      <p className="text-xs text-gray-500 mb-3">{lot.brand}</p>
      <div className="mt-auto flex items-center justify-between gap-2">
        <span className="text-base font-semibold text-gray-900">{lot.price.toLocaleString('fr-FR')} €</span>
        <Badge variant={CONDITION_VARIANTS[lot.condition]}>{lot.condition}</Badge>
      </div>
    </CardContent>
  </Card>
);

export default B2BPortal;
