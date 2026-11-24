import React, { useCallback, useEffect, useState } from 'react';
import { ImagePlus, Megaphone, Trash2, Eye, EyeOff } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { Badge } from '../../ui/Badge';

interface Announcement {
  id: string;
  title: string;
  image_url: string;
  link_url: string | null;
  link_label: string | null;
  is_active: boolean;
  starts_at: string;
  ends_at: string | null;
  created_at: string;
  views: { count: number }[];
}

const fmt = (d: string) => new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });

/**
 * Actualités B2B (0305) : affiches montrées en grand à la connexion au portail
 * revendeur, une seule fois par personne (AnnouncementPopup).
 */
export const AnnouncementsManager: React.FC = () => {
  const [items, setItems] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkLabel, setLinkLabel] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: e } = await supabase
      .from('b2b_announcements')
      .select('*, views:b2b_announcement_views(count)')
      .order('created_at', { ascending: false });
    if (e) setError(e.message);
    setItems((data || []) as Announcement[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const pickFile = (f: File | null) => {
    setFile(f);
    setPreview(f ? URL.createObjectURL(f) : null);
  };

  const publish = async () => {
    if (!file || !title.trim()) return;
    setSaving(true);
    setError(null);
    const ext = file.name.split('.').pop() || 'jpg';
    const path = `announcements/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error: upErr } = await supabase.storage.from('products-images').upload(path, file, { cacheControl: '3600', upsert: false });
    if (upErr) {
      setSaving(false);
      setError(upErr.message);
      return;
    }
    const { data: { publicUrl } } = supabase.storage.from('products-images').getPublicUrl(path);
    const { data: { user } } = await supabase.auth.getUser();
    const { error: insErr } = await supabase.from('b2b_announcements').insert({
      title: title.trim(),
      image_url: publicUrl,
      link_url: linkUrl.trim() || null,
      link_label: linkLabel.trim() || null,
      ends_at: endsAt ? new Date(`${endsAt}T23:59:59`).toISOString() : null,
      created_by: user?.id ?? null,
    });
    setSaving(false);
    if (insErr) {
      setError(insErr.message);
      return;
    }
    setTitle('');
    setLinkUrl('');
    setLinkLabel('');
    setEndsAt('');
    pickFile(null);
    load();
  };

  const toggle = async (a: Announcement) => {
    const { error: e } = await supabase.from('b2b_announcements').update({ is_active: !a.is_active }).eq('id', a.id);
    if (e) setError(e.message);
    load();
  };

  const remove = async (a: Announcement) => {
    if (!window.confirm(`Supprimer l'actualité « ${a.title} » ?`)) return;
    const { error: e } = await supabase.from('b2b_announcements').delete().eq('id', a.id);
    if (e) setError(e.message);
    load();
  };

  const live = (a: Announcement) => a.is_active && new Date(a.starts_at) <= new Date() && (!a.ends_at || new Date(a.ends_at) > new Date());

  return (
    <div className="space-y-6">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
          <Megaphone className="h-5 w-5" /> Actualités
        </h2>
        <p className="text-sm text-gray-500">
          Affiche montrée en grand à la connexion au portail B2B, une seule fois par personne (elle disparaît dès qu'elle est fermée).
        </p>
      </div>

      <div className="grid gap-4 rounded-xl border border-gray-200 bg-white p-4 md:grid-cols-2">
        <label className="flex min-h-[180px] cursor-pointer flex-col items-center justify-center overflow-hidden rounded-lg border-2 border-dashed border-gray-200 bg-gray-50 text-sm text-gray-500 hover:border-gray-400">
          {preview ? (
            <img src={preview} alt="" className="max-h-72 w-full object-contain" />
          ) : (
            <>
              <ImagePlus className="mb-2 h-8 w-8 text-gray-400" /> Choisir l'image de l'affiche
            </>
          )}
          <input type="file" accept="image/*" className="hidden" onChange={(e) => pickFile(e.target.files?.[0] || null)} />
        </label>
        <div className="space-y-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Titre (interne, sert aussi de texte alternatif)"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none"
          />
          <input
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            placeholder="Lien au clic (facultatif) — ex. /drops ou https://…"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none"
          />
          <input
            value={linkLabel}
            onChange={(e) => setLinkLabel(e.target.value)}
            placeholder="Texte du bouton sous l'affiche (facultatif)"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none"
          />
          <label className="block text-xs text-gray-500">
            Fin d'affichage (facultatif)
            <input
              type="date"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-gray-400 focus:outline-none"
            />
          </label>
          <button
            type="button"
            onClick={publish}
            disabled={saving || !file || !title.trim()}
            className="w-full rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {saving ? 'Publication…' : 'Publier maintenant'}
          </button>
        </div>
      </div>

      {error && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        {loading && items.length === 0 ? (
          <p className="p-6 text-sm text-gray-500">Chargement…</p>
        ) : items.length === 0 ? (
          <p className="p-6 text-sm text-gray-500">Aucune actualité publiée.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {items.map((a) => (
              <li key={a.id} className="flex items-center gap-4 p-4">
                <img src={a.image_url} alt="" className="h-16 w-24 flex-shrink-0 rounded-lg border border-gray-100 object-cover" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-gray-900">{a.title}</p>
                  <p className="text-xs text-gray-500">
                    Publiée le {fmt(a.created_at)}
                    {a.ends_at ? ` · jusqu'au ${fmt(a.ends_at)}` : ''} · vue par {a.views?.[0]?.count ?? 0} personne{(a.views?.[0]?.count ?? 0) > 1 ? 's' : ''}
                  </p>
                  {a.link_url && <p className="truncate text-xs text-gray-500">Lien : {a.link_url}</p>}
                </div>
                {live(a) ? <Badge variant="success">En ligne</Badge> : <Badge variant="default">Hors ligne</Badge>}
                <button
                  type="button"
                  onClick={() => toggle(a)}
                  title={a.is_active ? 'Retirer du portail' : 'Remettre en ligne'}
                  className="rounded-lg p-2 text-gray-400 hover:bg-gray-50 hover:text-gray-700"
                >
                  {a.is_active ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
                <button type="button" onClick={() => remove(a)} title="Supprimer" className="rounded-lg p-2 text-gray-400 hover:bg-red-50 hover:text-red-600">
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default AnnouncementsManager;
