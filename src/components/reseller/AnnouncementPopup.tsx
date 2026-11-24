import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface Announcement {
  id: string;
  title: string;
  image_url: string;
  link_url: string | null;
  link_label: string | null;
}

/**
 * Actualités (b2b_announcements, 0305) : à la connexion, chaque affiche en
 * cours pas encore vue s'ouvre en grand, la plus récente d'abord. Fermer
 * l'affiche l'enregistre comme vue : elle ne revient plus.
 */
export const AnnouncementPopup: React.FC<{ profileId: string | undefined }> = ({ profileId }) => {
  const [queue, setQueue] = useState<Announcement[]>([]);

  useEffect(() => {
    if (!profileId) return;
    let cancelled = false;
    (async () => {
      const [{ data: live }, { data: seen }] = await Promise.all([
        supabase.from('b2b_announcements').select('id, title, image_url, link_url, link_label').order('starts_at', { ascending: false }),
        supabase.from('b2b_announcement_views').select('announcement_id').eq('profile_id', profileId),
      ]);
      if (cancelled || !live) return;
      const seenIds = new Set((seen || []).map((v: { announcement_id: string }) => v.announcement_id));
      setQueue((live as Announcement[]).filter((a) => !seenIds.has(a.id)));
    })();
    return () => {
      cancelled = true;
    };
  }, [profileId]);

  const current = queue[0];
  if (!current || !profileId) return null;

  const close = () => {
    setQueue((q) => q.slice(1));
    supabase.from('b2b_announcement_views').insert({ announcement_id: current.id, profile_id: profileId }).then(() => {});
  };

  const image = <img src={current.image_url} alt={current.title} className="block max-h-[88vh] w-full rounded-xl object-contain shadow-2xl" />;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-2 sm:p-4" onClick={close}>
      <div className="relative w-[92vw] max-w-[1280px]" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={close}
          aria-label="Fermer"
          className="absolute -top-10 right-0 rounded-full p-1.5 text-white hover:bg-white/10"
        >
          <X className="h-7 w-7" />
        </button>
        {current.link_url ? (
          <a href={current.link_url} onClick={close} target={current.link_url.startsWith('/') ? undefined : '_blank'} rel="noreferrer">
            {image}
          </a>
        ) : (
          image
        )}
        {current.link_url && current.link_label && (
          <div className="mt-3 flex justify-center">
            <a
              href={current.link_url}
              onClick={close}
              target={current.link_url.startsWith('/') ? undefined : '_blank'}
              rel="noreferrer"
              className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-gray-900 hover:bg-gray-100"
            >
              {current.link_label}
            </a>
          </div>
        )}
      </div>
    </div>
  );
};
