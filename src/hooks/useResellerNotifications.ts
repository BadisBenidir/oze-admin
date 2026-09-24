import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export interface ResellerNotification {
  id: string;
  type: string;
  title: string;
  message: string;
  payload: { items?: Array<{ reference: string; name: string }> } | null;
  created_at: string;
}

/** Notifications non lues du profil connecté (reseller_notifications, 0159) —
 * affichées en bandeau dans l'espace pro jusqu'au clic "J'ai compris". La
 * RLS ne renvoie que celles du profil (profile_id = auth.uid()). */
export const useResellerNotifications = (profileId: string | undefined) => {
  const [notifications, setNotifications] = useState<ResellerNotification[]>([]);

  const fetchNotifications = useCallback(async () => {
    if (!profileId) {
      setNotifications([]);
      return;
    }
    const { data, error } = await supabase
      .from('reseller_notifications')
      .select('id, type, title, message, payload, created_at')
      .is('read_at', null)
      .order('created_at', { ascending: true });
    if (error) {
      console.error('Erreur lors du chargement des notifications:', error);
      return;
    }
    setNotifications((data || []) as ResellerNotification[]);
  }, [profileId]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  const markRead = async (id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    const { error } = await supabase.rpc('mark_reseller_notification_read', { p_notification_id: id });
    if (error) {
      console.error('Erreur lors du marquage de la notification:', error);
      fetchNotifications();
    }
  };

  return { notifications, markRead, refresh: fetchNotifications };
};
