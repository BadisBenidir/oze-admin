import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpen, Bot, Check, Loader2, Plus, Trash2 } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { useAdminAuth } from '../../../hooks/useAdminAuth';

interface KbEntry {
  id: string;
  category: string;
  title: string;
  content: string;
  /** Consignes de comportement ([BOT], 0267) : envoyées au modèle, jamais au client. */
  bot_notes: string;
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
      .update({ category: entry.category.trim() || 'Général', title: entry.title.trim(), content: entry.content.trim(), bot_notes: entry.bot_notes.trim(), active: entry.active, position: entry.position, updated_at: new Date().toISOString(), updated_by: profile?.id ?? null })
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

  const add = async (category = 'Général') => {
    const inCategory = entries.filter((e) => e.category === category);
    const position = ((inCategory.length ? inCategory : entries)[(inCategory.length ? inCategory : entries).length - 1]?.position ?? 0) + 1;
    const { error: e } = await supabase
      .from('sav_knowledge_base')
      .insert({ category, title: 'Nouvelle question', content: '', bot_notes: '', position, updated_by: profile?.id ?? null });
    if (e) return setError(e.message);
    load();
  };

  const remove = async (entry: KbEntry) => {
    if (!window.confirm(`Supprimer la section « ${entry.title} » ?`)) return;
    const { error: e } = await supabase.from('sav_knowledge_base').delete().eq('id', entry.id);
    if (e) return setError(e.message);
    load();
  };

  // Regroupement par rubrique, dans l'ordre des positions.
  const groups = useMemo(() => {
    const map = new Map<string, KbEntry[]>();
    entries.forEach((e) => map.set(e.category, [...(map.get(e.category) || []), e]));
    return Array.from(map.entries());
  }, [entries]);
  const categories = groups.map(([c]) => c);

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gray-900 text-white"><BookOpen className="h-5 w-5" /></div>
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Base de connaissances du chatbot</h1>
            <p className="text-sm text-gray-500">
              Le bot reprend les réponses types des questions actives et suit leurs consignes. Tout le reste est transmis à l'équipe.
            </p>
          </div>
        </div>
        <button onClick={() => add()} className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800">
          <Plus className="h-4 w-4" /> Ajouter une question
        </button>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {loading ? (
        <div className="flex justify-center p-10 text-gray-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : (
        <div className="space-y-8">
          <datalist id="kb-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
          {groups.map(([category, list]) => (
          <section key={category} className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">{category} <span className="font-normal normal-case text-gray-400">· {list.length}</span></h2>
              <button onClick={() => add(category)} className="inline-flex items-center gap-1 text-xs font-medium text-gray-600 hover:text-gray-900">
                <Plus className="h-3.5 w-3.5" /> Question
              </button>
            </div>
          {list.map((e) => (
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
              <input
                value={e.category}
                list="kb-categories"
                onChange={(ev) => edit(e.id, { category: ev.target.value })}
                className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600"
                placeholder="Rubrique"
                title="Rubrique"
              />
              <label className="mt-2 block text-xs font-medium text-gray-500">Réponse type (vue par le client, au vouvoiement)</label>
              <textarea
                value={e.content}
                onChange={(ev) => edit(e.id, { content: ev.target.value })}
                rows={Math.min(12, Math.max(2, e.content.split('\n').length + 1))}
                className="mt-1 w-full rounded-lg border border-gray-200 p-3 text-sm text-gray-800"
                placeholder="Réponse que le bot reprend"
              />
              <label className="mt-2 flex items-center gap-1 text-xs font-medium text-amber-700">
                <Bot className="h-3.5 w-3.5" /> Consignes au bot (jamais montrées au client)
              </label>
              <textarea
                value={e.bot_notes}
                onChange={(ev) => edit(e.id, { bot_notes: ev.target.value })}
                rows={Math.min(10, Math.max(2, e.bot_notes.split('\n').length + 1))}
                className="mt-1 w-full rounded-lg border border-amber-200 bg-amber-50/50 p-3 text-sm text-gray-800"
                placeholder="Ex. : ouvre un ticket « Authenticité »…"
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
          </section>
          ))}
        </div>
      )}
    </div>
  );
};
