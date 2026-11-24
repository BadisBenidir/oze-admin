import React, { useCallback, useEffect, useState } from 'react';
import { Megaphone, Trash2, Eye, EyeOff, Smartphone, Monitor, RotateCcw, Link2, Repeat } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { Badge } from '../../ui/Badge';

interface Announcement {
  id: string;
  title: string;
  image_url: string;
  mobile_image_url: string | null;
  link_url: string | null;
  link_label: string | null;
  repeat_every_hours: number | null;
  is_active: boolean;
  starts_at: string;
  ends_at: string | null;
  created_at: string;
  views: { count: number }[];
}

const fmt = (d: string) => new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });

/** Envoie une image d'affiche dans le stockage, renvoie son URL publique. */
const uploadImage = async (file: File): Promise<string> => {
  const ext = file.name.split('.').pop() || 'jpg';
  const path = `announcements/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage.from('products-images').upload(path, file, { cacheControl: '3600', upsert: false });
  if (error) throw new Error(error.message);
  return supabase.storage.from('products-images').getPublicUrl(path).data.publicUrl;
};

const ImagePicker: React.FC<{
  label: string;
  hint: string;
  icon: React.ReactNode;
  preview: string | null;
  onPick: (f: File | null) => void;
  tall?: boolean;
}> = ({ label, hint, icon, preview, onPick, tall }) => (
  <label
    className={`flex cursor-pointer flex-col items-center justify-center overflow-hidden rounded-lg border-2 border-dashed border-gray-200 bg-gray-50 p-2 text-center text-sm text-gray-500 hover:border-gray-400 ${
      tall ? 'min-h-[220px]' : 'min-h-[180px]'
    }`}
  >
    {preview ? (
      <img src={preview} alt="" className={`${tall ? 'max-h-80' : 'max-h-72'} w-full object-contain`} />
    ) : (
      <>
        <span className="mb-2 text-gray-400">{icon}</span>
        <span className="font-medium text-gray-700">{label}</span>
        <span className="mt-0.5 text-xs text-gray-400">{hint}</span>
      </>
    )}
    <input type="file" accept="image/*" className="hidden" onChange={(e) => onPick(e.target.files?.[0] || null)} />
  </label>
);

/**
 * Actualités B2B (0305, 0307) : affiches montrées en grand à la connexion au
 * portail revendeur, une seule fois par personne (AnnouncementPopup). Une
 * version téléphone (portrait) facultative remplace l'affiche sur mobile.
 */
export const AnnouncementsManager: React.FC = () => {
  const [items, setItems] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [mobileFile, setMobileFile] = useState<File | null>(null);
  const [mobilePreview, setMobilePreview] = useState<string | null>(null);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkLabel, setLinkLabel] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [repeat, setRepeat] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

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
  const pickMobileFile = (f: File | null) => {
    setMobileFile(f);
    setMobilePreview(f ? URL.createObjectURL(f) : null);
  };

  const publish = async () => {
    if (!file || !title.trim()) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const imageUrl = await uploadImage(file);
      const mobileUrl = mobileFile ? await uploadImage(mobileFile) : null;
      const { data: { user } } = await supabase.auth.getUser();
      const { error: insErr } = await supabase.from('b2b_announcements').insert({
        title: title.trim(),
        image_url: imageUrl,
        mobile_image_url: mobileUrl,
        link_url: linkUrl.trim() || null,
        link_label: linkLabel.trim() || null,
        ends_at: endsAt ? new Date(`${endsAt}T23:59:59`).toISOString() : null,
        repeat_every_hours: repeat ? 1 : null,
        created_by: user?.id ?? null,
      });
      if (insErr) throw new Error(insErr.message);
      setTitle('');
      setLinkUrl('');
      setLinkLabel('');
      setEndsAt('');
      setRepeat(false);
      pickFile(null);
      pickMobileFile(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setSaving(false);
    }
  };

  const setMobileImage = async (a: Announcement, f: File | null) => {
    if (!f) return;
    setBusyId(a.id);
    setError(null);
    setNotice(null);
    try {
      const url = await uploadImage(f);
      const { error: e } = await supabase.from('b2b_announcements').update({ mobile_image_url: url }).eq('id', a.id);
      if (e) throw new Error(e.message);
      setNotice(`Version téléphone enregistrée pour « ${a.title} ».`);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setBusyId(null);
    }
  };

  const removeMobileImage = async (a: Announcement) => {
    const { error: e } = await supabase.from('b2b_announcements').update({ mobile_image_url: null }).eq('id', a.id);
    if (e) setError(e.message);
    load();
  };

  const toggleRepeat = async (a: Announcement) => {
    const { error: e } = await supabase.from('b2b_announcements').update({ repeat_every_hours: a.repeat_every_hours ? null : 1 }).eq('id', a.id);
    if (e) setError(e.message);
    load();
  };

  const editLink = async (a: Announcement) => {
    const next = window.prompt(
      "Lien au clic sur l'affiche (vide = aucun lien).\nEx. /catalogue?livraison=1 pour le catalogue filtré « Livraison disponible ».",
      a.link_url || '/catalogue?livraison=1'
    );
    if (next === null) return;
    const { error: e } = await supabase.from('b2b_announcements').update({ link_url: next.trim() || null }).eq('id', a.id);
    if (e) setError(e.message);
    load();
  };

  // Efface les vues : l'affiche revient à la prochaine connexion de chacun.
  const resetViews = async (a: Announcement) => {
    if (!window.confirm(`Réafficher « ${a.title} » à tout le monde (vous compris) à la prochaine connexion ?`)) return;
    setNotice(null);
    const { error: e } = await supabase.from('b2b_announcement_views').delete().eq('announcement_id', a.id);
    if (e) setError(e.message);
    else setNotice(`« ${a.title} » sera réaffichée à la prochaine connexion de chacun.`);
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

      <div className="grid gap-4 rounded-xl border border-gray-200 bg-white p-4 md:grid-cols-[1fr_200px_1fr]">
        <ImagePicker
          label="Affiche ordinateur"
          hint="Format paysage"
          icon={<Monitor className="h-8 w-8" />}
          preview={preview}
          onPick={pickFile}
        />
        <ImagePicker
          label="Version téléphone"
          hint="Facultatif · format portrait"
          icon={<Smartphone className="h-8 w-8" />}
          preview={mobilePreview}
          onPick={pickMobileFile}
          tall
        />
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
            placeholder="Lien au clic (facultatif) — ex. /catalogue?livraison=1"
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
          <label className="flex cursor-pointer items-start gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-gray-300" />
            <span>
              Réafficher à chaque connexion
              <span className="block text-xs text-gray-400">Au plus une fois par heure. Sinon : une seule fois par personne.</span>
            </span>
          </label>
          <button
            type="button"
            onClick={publish}
            disabled={saving || !file || !title.trim()}
            className="w-full rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {saving ? 'Publication…' : 'Publier maintenant'}
          </button>
          <p className="text-xs text-gray-400">Sans version téléphone, l'affiche ordinateur est montrée aussi sur mobile.</p>
        </div>
      </div>

      {error && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {notice && <p className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700">{notice}</p>}

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        {loading && items.length === 0 ? (
          <p className="p-6 text-sm text-gray-500">Chargement…</p>
        ) : items.length === 0 ? (
          <p className="p-6 text-sm text-gray-500">Aucune actualité publiée.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {items.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-4 p-4">
                <img src={a.image_url} alt="" title="Ordinateur" className="h-16 w-24 flex-shrink-0 rounded-lg border border-gray-100 object-cover" />
                {a.mobile_image_url ? (
                  <img src={a.mobile_image_url} alt="" title="Téléphone" className="h-16 w-10 flex-shrink-0 rounded-md border border-gray-100 object-cover" />
                ) : (
                  <div title="Pas de version téléphone" className="flex h-16 w-10 flex-shrink-0 items-center justify-center rounded-md border border-dashed border-gray-200 text-gray-300">
                    <Smartphone className="h-4 w-4" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-gray-900">{a.title}</p>
                  <p className="text-xs text-gray-500">
                    Publiée le {fmt(a.created_at)}
                    {a.ends_at ? ` · jusqu'au ${fmt(a.ends_at)}` : ''} · {a.repeat_every_hours ? `à chaque connexion (1×/${a.repeat_every_hours} h max)` : 'une seule fois'} · vue par {a.views?.[0]?.count ?? 0} personne{(a.views?.[0]?.count ?? 0) > 1 ? 's' : ''}
                  </p>
                  {a.link_url && <p className="truncate text-xs text-gray-500">Lien : {a.link_url}</p>}
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    <label className={`inline-flex cursor-pointer items-center gap-1 font-medium text-gray-700 hover:text-gray-900 ${busyId === a.id ? 'opacity-50' : ''}`}>
                      <Smartphone className="h-3.5 w-3.5" />
                      {busyId === a.id ? 'Envoi…' : a.mobile_image_url ? 'Changer la version téléphone' : 'Ajouter une version téléphone'}
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        disabled={busyId === a.id}
                        onChange={(e) => {
                          setMobileImage(a, e.target.files?.[0] || null);
                          e.target.value = '';
                        }}
                      />
                    </label>
                    {a.mobile_image_url && (
                      <button type="button" onClick={() => removeMobileImage(a)} className="text-gray-500 underline hover:text-gray-700">
                        Retirer
                      </button>
                    )}
                    <button type="button" onClick={() => toggleRepeat(a)} className="inline-flex items-center gap-1 font-medium text-gray-700 hover:text-gray-900">
                      <Repeat className="h-3.5 w-3.5" /> {a.repeat_every_hours ? 'Afficher une seule fois' : 'Réafficher à chaque connexion'}
                    </button>
                    <button type="button" onClick={() => editLink(a)} className="inline-flex items-center gap-1 font-medium text-gray-700 hover:text-gray-900">
                      <Link2 className="h-3.5 w-3.5" /> {a.link_url ? 'Modifier le lien' : 'Ajouter un lien'}
                    </button>
                    <button type="button" onClick={() => resetViews(a)} className="inline-flex items-center gap-1 font-medium text-gray-700 hover:text-gray-900">
                      <RotateCcw className="h-3.5 w-3.5" /> Réafficher à tout le monde
                    </button>
                  </div>
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
