// Accès admin des fonctions Edge (0208) : le propriétaire (role 'admin')
// a toujours accès ; un employé (role 'staff') seulement s'il est actif et,
// pour une action sensible, si elle lui a été donnée (staff_permissions
// .actions : 'wallet' | 'refunds' | 'invoicing' | 'accounts').
// Sans action : toute personne de l'équipe active (opérations courantes :
// bordereaux, suivi Sendcloud…).

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export type AdminAction = 'wallet' | 'refunds' | 'invoicing' | 'accounts';

export async function hasAdminAccess(client: SupabaseClient, userId: string, action?: AdminAction): Promise<boolean> {
  const { data: profile } = await client.from('profiles').select('role').eq('id', userId).maybeSingle();
  if (profile?.role === 'admin') return true;
  if (profile?.role !== 'staff') return false;
  const { data: perms } = await client
    .from('staff_permissions')
    .select('active, actions')
    .eq('profile_id', userId)
    .maybeSingle();
  if (!perms?.active) return false;
  return !action || ((perms.actions as string[] | null) || []).includes(action);
}
