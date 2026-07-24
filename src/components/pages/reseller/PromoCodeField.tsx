import React, { useState } from 'react';
import { Tag, X, AlertCircle } from 'lucide-react';
import { supabase } from '../../../lib/supabase';

export interface AppliedPromo {
  code: string;
  promoCodeId: string;
  discountAmount: number;
}

interface PromoCodeFieldProps {
  subtotal: number;
  applied: AppliedPromo | null;
  onApply: (promo: AppliedPromo) => void;
  onRemove: () => void;
}

export const PromoCodeField: React.FC<PromoCodeFieldProps> = ({ subtotal, applied, onApply, onRemove }) => {
  const [code, setCode] = useState('');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');

  const handleApply = async () => {
    if (!code.trim()) return;
    setChecking(true);
    setError('');

    const { data, error: rpcError } = await supabase.rpc('validate_promo_code', {
      p_code: code.trim(),
      p_subtotal: subtotal,
    });
    setChecking(false);

    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    if (!data?.valid) {
      setError(data?.error || 'Code promo invalide');
      return;
    }

    onApply({ code: data.code, promoCodeId: data.promo_code_id, discountAmount: Number(data.discount_amount) });
    setCode('');
  };

  if (applied) {
    return (
      <div className="flex items-center justify-between gap-2 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
        <div className="flex items-center gap-2 text-sm text-green-800">
          <Tag className="h-4 w-4 flex-shrink-0" />
          <span>Code <span className="font-mono font-semibold">{applied.code}</span> appliqué</span>
        </div>
        <button onClick={onRemove} className="p-1 text-green-700 hover:text-green-900 transition-colors" title="Retirer le code">
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Tag className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            value={code}
            onChange={(e) => { setCode(e.target.value.toUpperCase()); setError(''); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleApply(); } }}
            placeholder="Code promo"
            className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-gray-400 text-sm font-mono uppercase"
          />
        </div>
        <button
          onClick={handleApply}
          disabled={checking || !code.trim()}
          className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50 text-sm font-medium whitespace-nowrap"
        >
          {checking ? 'Vérification...' : 'Appliquer'}
        </button>
      </div>
      {error && (
        <p className="mt-2 text-sm text-red-600 flex items-center gap-1.5">
          <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
};
