import React, { useCallback, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { BarcodeScanner } from './BarcodeScanner';
import { ScanLine, AlertCircle } from 'lucide-react';

interface ProductScannerPageProps {
  /** Ouvre la fiche détail du produit scanné. */
  onOpenProduct: (productId: string) => void;
}

/**
 * Page « Scanner » : on vise le QR Code d'une étiquette et on est redirigé vers
 * la fiche de l'article correspondant. (La mise en ligne se fait dans l'onglet
 * « En attente », pas ici.)
 */
export const ProductScannerPage: React.FC<ProductScannerPageProps> = ({ onOpenProduct }) => {
  const [manual, setManual] = useState('');
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const lastScanRef = useRef<{ code: string; at: number }>({ code: '', at: 0 });

  const lookup = useCallback(
    async (code: string) => {
      const trimmed = code.trim();
      if (!trimmed) return;
      const { data: product, error: qErr } = await supabase
        .from('products')
        .select('id')
        .eq('barcode', trimmed)
        .maybeSingle();

      if (qErr) {
        setError(qErr.message);
        return;
      }
      if (!product) {
        setError(`Référence inconnue : ${trimmed}`);
        return;
      }
      setError(null);
      onOpenProduct(product.id); // redirige vers la fiche (la page se démonte)
    },
    [onOpenProduct],
  );

  const handleDetected = useCallback(
    async (code: string) => {
      const now = Date.now();
      if (busyRef.current) return;
      if (code === lastScanRef.current.code && now - lastScanRef.current.at < 2500) return;
      lastScanRef.current = { code, at: now };
      busyRef.current = true;
      try {
        await lookup(code);
      } finally {
        busyRef.current = false;
      }
    },
    [lookup],
  );

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await lookup(manual.trim().toUpperCase());
  };

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto">
      <div className="mb-4 md:mb-6">
        <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <ScanLine className="h-5 w-5" /> Scanner un article
        </h3>
        <p className="text-sm text-gray-500">
          Vise le QR Code de l'étiquette : tu es redirigé vers la fiche de l'article.
        
        </p>
      </div>

      <BarcodeScanner onDetected={handleDetected} />

      {/* Saisie manuelle (repli) */}
      <form onSubmit={handleManualSubmit} className="mt-4 flex items-center gap-2">
        <input
          type="text"
          value={manual}
          onChange={(e) => setManual(e.target.value.toUpperCase())}
          placeholder="Saisir une référence (ex: OZ-DIO-009)"
          className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
        />
        <button
          type="submit"
          className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors text-sm font-medium"
        >
          Ouvrir
        </button>
      </form>

      {error && (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle className="h-5 w-5 flex-shrink-0" />
          {error}
        </div>
      )}
    </div>
  );
};