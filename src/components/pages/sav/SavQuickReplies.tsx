import React, { useEffect, useState } from 'react';
import { Check, MessageCircleQuestion, Plus, Trash2, Zap } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { SavQuickReply, useSavQuickReplies } from '../../../hooks/useSavAdmin';

/**
 * Réponses rapides de l'équipe SAV (sav_quick_replies, 0269) : proposées
 * dans le menu « Réponses rapides » de la fiche ticket. « Question Oui /
 * Non » : envoyée avec des boutons Oui / Non côté client (« Non » ferme la
 * demande).
 */
export const SavQuickReplies: React.FC = () => {
  const { replies, refresh } = useSavQuickReplies(false);
  const [rows, setRows] = useState<SavQuickReply[]>([]);
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [savedId, setSavedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRows(replies);
    setDirty(new Set());
  }, [replies]);

  const edit = (id: string, patch: Partial<SavQuickReply>) => {
    setRows((list) => list.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    setDirty((d) => new Set(d).add(id));
  };

  const save = async (r: SavQuickReply) => {
    setError(null);
    const { error: e } = await supabase
      .from('sav_quick_replies')
      .update({ title: r.title.trim(), content: r.content.trim(), yes_no: r.yes_no, active: r.active, position: r.position, updated_at: new Date().toISOString() })
      .eq('id', r.id);
    if (e) return setError(e.message);
    setDirty((d) => {
      const n = new Set(d);
      n.delete(r.id);
      return n;
    });
    setSavedId(r.id);
    window.setTimeout(() => setSavedId((s) => (s === r.id ? null : s)), 1500);
  };

  const add = async () => {
    const position = (rows[rows.length - 1]?.position ?? 0) + 10;
    const { error: e } = await supabase.from('sav_quick_replies').insert({ title: 'Nouvelle réponse', content: '', position });
    if (e) return setError(e.message);
    refresh();
  };

  const remove = async (r: SavQuickReply) => {
    if (!window.confirm(`Supprimer la réponse rapide « ${r.title} » ?`)) return;
    const { error: e } = await supabase.from('sav_quick_replies').delete().eq('id', r.id);
    if (e) return setError(e.message);
    refresh();
  };

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gray-900 text-white"><Zap className="h-5 w-5" /></div>
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Réponses rapides</h1>
            <p className="text-sm text-gray-500">Insérées en un clic depuis la fiche ticket (bouton « Réponses rapides »), modifiables avant envoi.</p>
          </div>
        </div>
        <button onClick={add} className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800">
          <Plus className="h-4 w-4" /> Ajouter
        </button>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <div className="space-y-3">
        {rows.map((r) => (
          <div key={r.id} className={`rounded-xl border bg-white p-4 ${r.active ? 'border-gray-200' : 'border-dashed border-gray-300 opacity-70'}`}>
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={r.title}
                onChange={(e) => edit(r.id, { title: e.target.value })}
                className="min-w-[200px] flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-900"
                placeholder="Titre (visible de l'équipe uniquement)"
              />
              <input
                type="number"
                value={r.position}
                onChange={(e) => edit(r.id, { position: Number(e.target.value) || 0 })}
                className="w-20 rounded-lg border border-gray-200 px-2 py-2 text-sm text-gray-700"
                title="Ordre"
              />
              <label className="flex items-center gap-1.5 text-sm text-gray-700">
                <input type="checkbox" checked={r.active} onChange={(e) => edit(r.id, { active: e.target.checked })} className="h-4 w-4 accent-gray-900" />
                Active
              </label>
              <button onClick={() => remove(r)} className="rounded-lg p-2 text-gray-400 hover:bg-red-50 hover:text-red-600" title="Supprimer">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            <textarea
              value={r.content}
              onChange={(e) => edit(r.id, { content: e.target.value })}
              rows={Math.min(8, Math.max(2, r.content.split('\n').length + 1))}
              className="mt-2 w-full rounded-lg border border-gray-200 p-3 text-sm text-gray-800"
              placeholder="Texte envoyé au client"
            />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <label className={`inline-flex items-center gap-1.5 text-sm ${r.yes_no ? 'text-blue-700' : 'text-gray-600'}`}>
                <input type="checkbox" checked={r.yes_no} onChange={(e) => edit(r.id, { yes_no: e.target.checked })} className="h-4 w-4 accent-blue-600" />
                <MessageCircleQuestion className="h-4 w-4" /> Question Oui / Non (« Non » ferme la demande)
              </label>
              <div className="flex items-center gap-2">
                {savedId === r.id && <span className="inline-flex items-center gap-1 text-xs text-green-600"><Check className="h-3.5 w-3.5" /> Enregistré</span>}
                <button
                  onClick={() => save(r)}
                  disabled={!dirty.has(r.id)}
                  className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-40"
                >
                  Enregistrer
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
