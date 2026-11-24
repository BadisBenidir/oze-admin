import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface Announcement {
  id: string;
  title: string;
  image_url: string;
  /** Version téléphone (portrait), affichée à la place sur petit écran (0307). */
  mobile_image_url: string | null;
  link_url: string | null;
  link_label: string | null;
  /** null : une seule fois ; sinon revient si la dernière vue date d'au moins N h (0308). */
  repeat_every_hours: number | null;
}

/**
 * Actualités (b2b_announcements, 0305) : à la connexion, chaque affiche en
 * cours s'ouvre en grand, la plus récente d'abord, si elle n'a jamais été vue
 * — ou, pour une affiche répétée, si la dernière vue date d'au moins
 * repeat_every_hours. Fermer l'affiche enregistre (ou rafraîchit) la vue.
 */
export const AnnouncementPopup: React.FC<{ profileId: string | undefined }> = ({ profileId }) => {
  const [queue, setQueue] = useState<Announcement[]>([]);

  useEffect(() => {
    if (!profileId) return;
    let cancelled = false;
    (async () => {
      const [{ data: live }, { data: seen }] = await Promise.all([
        supabase
          .from('b2b_announcements')
          .select('id, title, image_url, mobile_image_url, link_url, link_label, repeat_every_hours')
          .order('starts_at', { ascending: false }),
        supabase.from('b2b_announcement_views').select('announcement_id, seen_at').eq('profile_id', profileId),
      ]);
      if (cancelled || !live) return;
      const seenAt = new Map((seen || []).map((v: { announcement_id: string; seen_at: string }) => [v.announcement_id, new Date(v.seen_at).getTime()]));
      const now = Date.now();
      setQueue(
        (live as Announcement[]).filter((a) => {
          const last = seenAt.get(a.id);
          if (last === undefined) return true;
          return !!a.repeat_every_hours && now - last >= a.repeat_every_hours * 3_600_000;
        })
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [profileId]);

  const current = queue[0];
  if (!current || !profileId) return null;

  const markSeen = () =>
    supabase
      .from('b2b_announcement_views')
      .upsert({ announcement_id: current.id, profile_id: profileId, seen_at: new Date().toISOString() }, { onConflict: 'announcement_id,profile_id' })
      .then(({ error }) => {
        if (error) console.error('Actualité non marquée vue :', error.message);
      });

  const close = () => {
    setQueue((q) => q.slice(1));
    markSeen();
  };

  // Lien interne (ex. /catalogue?livraison=1) : on enregistre la vue AVANT de
  // changer de page, sinon la requête peut être coupée et l'affiche revenir.
  const follow = async (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (!current.link_url?.startsWith('/')) {
      close();
      return;
    }
    e.preventDefault();
    setQueue((q) => q.slice(1));
    await markSeen();
    window.location.assign(current.link_url);
  };

  // Téléphone (< 640 px) : version portrait si elle existe, sinon l'affiche principale.
  const image = (
    <picture>
      {current.mobile_image_url && <source media="(max-width: 639px)" srcSet={current.mobile_image_url} />}
      <img src={current.image_url} alt={current.title} className="block max-h-[82vh] w-full rounded-xl object-contain shadow-2xl" />
    </picture>
  );

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-2 sm:p-4" onClick={close}>
      <div className="relative w-[86vw] max-w-5xl sm:w-full" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={close}
          aria-label="Fermer"
          className="absolute -top-10 right-0 rounded-full p-1.5 text-white hover:bg-white/10"
        >
          <X className="h-7 w-7" />
        </button>
        {current.link_url ? (
          <a href={current.link_url} onClick={follow} className="block cursor-pointer" target={current.link_url.startsWith('/') ? undefined : '_blank'} rel="noreferrer">
            {image}
          </a>
        ) : (
          image
        )}
        {current.link_url && current.link_label && (
          <div className="mt-3 flex justify-center">
            <a
              href={current.link_url}
              onClick={follow}
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
