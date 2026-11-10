import React, { useCallback, useEffect, useState } from 'react';
import { BookOpen, Check, Loader2, Plus, Trash2 } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { useAdminAuth } from '../../../hooks/useAdminAuth';

interface KbEntry {
  id: string;
  title: string;
  content: string;
  active: boolean;
  position: number;
  updated_at: string;
}

/**
 * Base de connaissances du chatbot (sav_knowledge_base, 0263) : le bot ne
 * s'appuie que sur les sections actives ci-dessous (et les données du client
 * connecté). Prise en compte dès la conversation suivante.
 */
export const SavKnowledgeBase: React.FC = () => {
  const { profile } = useAdminAuth();
  const [entries, setEntries] = useState<KbEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [dirty, setDirty] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: e } = await supabase.from('sav_knowledge_base').select('*').order('position');
    if (e) setError(e.message);
    else setEntries((data || []) as KbEntry[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const edit = (id: string, patch: Partial<KbEntry>) => {
    setEntries((list) => list.map((e) => (e.id === id ? { ...e, ...patch } : e)));
    setDirty((d) => new Set(d).add(id));
  };

  const save = async (entry: KbEntry) => {
    setSavingId(entry.id);
    setError(null);
    const { error: e } = await supabase
      .from('sav_knowledge_base')
      .update({ title: entry.title.trim(), content: entry.content.trim(), active: entry.active, position: entry.position, updated_at: new Date().toISOString(), updated_by: profile?.id ?? null })
      .eq('id', entry.id);
    setSavingId(null);
    if (e) return setError(e.message);
    setDirty((d) => {
      const n = new Set(d);
      n.delete(entry.id);
      return n;
    });
    setSavedId(entry.id);
    window.setTimeout(() => setSavedId((s) => (s === entry.id ? null : s)), 1500);
  };

  const add = async () => {
    const position = (entries[entries.length - 1]?.position ?? 0) + 10;
    const { error: e } = await supabase.from('sav_knowledge_base').insert({ title: 'Nouvelle section', content: '', position, updated_by: profile?.id ?? null });
    if (e) return setError(e.message);
    load();
  };

  const remove = async (entry: KbEntry) => {
    if (!window.confirm(`Supprimer la section « ${entry.title} » ?`)) return;
    const { error: e } = await supabase.from('sav_knowledge_base').delete().eq('id', entry.id);
    if (e) return setError(e.message);
    load();
  };

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gray-900 text-white"><BookOpen className="h-5 w-5" /></div>
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Base de connaissances du chatbot</h1>
            <p className="text-sm text-gray-500">Le bot ne répond qu'à partir des sections actives. Tout le reste est transmis à l'équipe.</p>
          </div>
        </div>
        <button onClick={add} className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800">
          <Plus className="h-4 w-4" /> Ajouter une section
        </button>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {loading ? (
        <div className="flex justify-center p-10 text-gray-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : (
        <div className="space-y-3">
          {entries.map((e) => (
            <div key={e.id} className={`rounded-xl border bg-white p-4 ${e.active ? 'border-gray-200' : 'border-dashed border-gray-300 opacity-70'}`}>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={e.title}
                  onChange={(ev) => edit(e.id, { title: ev.target.value })}
                  className="min-w-[200px] flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-900"
                />
                <input
                  type="number"
                  value={e.position}
                  onChange={(ev) => edit(e.id, { position: Number(ev.target.value) || 0 })}
                  className="w-20 rounded-lg border border-gray-200 px-2 py-2 text-sm text-gray-700"
                  title="Ordre"
                />
                <label className="flex items-center gap-1.5 text-sm text-gray-700">
                  <input type="checkbox" checked={e.active} onChange={(ev) => edit(e.id, { active: ev.target.checked })} className="h-4 w-4 accent-gray-900" />
                  Active
                </label>
                <button onClick={() => remove(e)} className="rounded-lg p-2 text-gray-400 hover:bg-red-50 hover:text-red-600" title="Supprimer">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <textarea
                value={e.content}
                onChange={(ev) => edit(e.id, { content: ev.target.value })}
                rows={Math.min(12, Math.max(3, e.content.split('\n').length + 1))}
                className="mt-2 w-full rounded-lg border border-gray-200 p-3 text-sm text-gray-800"
                placeholder="Contenu (texte libre ou Markdown)"
              />
              <div className="mt-2 flex items-center justify-end gap-2">
                {savedId === e.id && <span className="inline-flex items-center gap-1 text-xs text-green-600"><Check className="h-3.5 w-3.5" /> Enregistré</span>}
                <button
                  onClick={() => save(e)}
                  disabled={!dirty.has(e.id) || savingId === e.id}
                  className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-40"
                >
                  {savingId === e.id ? 'Enregistrement…' : 'Enregistrer'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
