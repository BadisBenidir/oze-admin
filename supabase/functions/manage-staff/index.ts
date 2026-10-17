// Edge Function : manage-staff
//
// Comptes employés de l'admin (0208) — RÉSERVÉ AU PROPRIÉTAIRE (role
// 'admin', jamais un employé). Actions (corps JSON, champ `action`) :
//   - create   { email, password, first_name, last_name, pages, actions, show_figures }
//              crée le compte Auth (email confirmé, mot de passe choisi par
//              le propriétaire), le profil role 'staff' et ses droits ;
//   - update   { profile_id, first_name, last_name, pages, actions, show_figures, active }
//              droits / nom / accès ouvert ou suspendu (suspendu : sessions
//              révoquées immédiatement) ;
//   - password { profile_id, password }  nouveau mot de passe (sessions révoquées) ;
//   - delete   { profile_id }  supprime le compte.
// Nécessite la clé service-role (création d'utilisateurs Auth).
// Déploiement : `supabase functions deploy manage-staff`

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const ACTIONS = ['wallet', 'refunds', 'invoicing', 'accounts'];
const cleanList = (value: unknown, allowed?: string[]) =>
  Array.isArray(value)
    ? Array.from(new Set(value.filter((v): v is string => typeof v === 'string' && (!allowed || allowed.includes(v)))))
    : [];

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Non authentifié' }, 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const callerClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await callerClient.auth.getUser();
    if (!user) return json({ error: 'Non authentifié' }, 401);
    const { data: me } = await callerClient.from('profiles').select('role').eq('id', user.id).maybeSingle();
    if (me?.role !== 'admin') return json({ error: 'Réservé au propriétaire du compte' }, 403);

    const admin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const body = await req.json();
    const action = body?.action;

    const ensureStaff = async (profileId: string) => {
      const { data } = await admin.from('profiles').select('role').eq('id', profileId).maybeSingle();
      return data?.role === 'staff';
    };

    if (action === 'create') {
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      const firstName = String(body.first_name || '').trim();
      const lastName = String(body.last_name || '').trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'Email invalide' }, 400);
      if (password.length < 8) return json({ error: 'Mot de passe : 8 caractères minimum' }, 400);
      if (!firstName) return json({ error: 'Prénom requis' }, 400);

      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { first_name: firstName, last_name: lastName },
      });
      if (createError || !created?.user) {
        const message = createError?.message || 'Création du compte impossible';
        return json({ error: /already|registered|exists/i.test(message) ? 'Un compte existe déjà avec cet email' : message }, 400);
      }
      const profileId = created.user.id;

      const { error: profileError } = await admin.from('profiles').upsert({
        id: profileId,
        email,
        first_name: firstName,
        last_name: lastName,
        role: 'staff',
      });
      if (profileError) {
        await admin.auth.admin.deleteUser(profileId);
        return json({ error: profileError.message }, 400);
      }

      const { error: permsError } = await admin.from('staff_permissions').insert({
        profile_id: profileId,
        pages: cleanList(body.pages),
        actions: cleanList(body.actions, ACTIONS),
        show_figures: Boolean(body.show_figures),
        active: true,
        created_by: user.id,
      });
      if (permsError) {
        await admin.auth.admin.deleteUser(profileId);
        return json({ error: permsError.message }, 400);
      }
      return json({ success: true, profile_id: profileId });
    }

    const profileId = String(body?.profile_id || '');
    if (!profileId) return json({ error: 'profile_id requis' }, 400);
    if (!(await ensureStaff(profileId))) return json({ error: "Ce compte n'est pas un compte employé" }, 400);

    if (action === 'update') {
      const active = body.active !== false;
      const { error: profileError } = await admin
        .from('profiles')
        .update({ first_name: String(body.first_name || '').trim(), last_name: String(body.last_name || '').trim() })
        .eq('id', profileId);
      if (profileError) return json({ error: profileError.message }, 400);
      const { error: permsError } = await admin
        .from('staff_permissions')
        .update({
          pages: cleanList(body.pages),
          actions: cleanList(body.actions, ACTIONS),
          show_figures: Boolean(body.show_figures),
          active,
          updated_at: new Date().toISOString(),
        })
        .eq('profile_id', profileId);
      if (permsError) return json({ error: permsError.message }, 400);
      if (!active) await admin.rpc('revoke_user_sessions', { target_user_id: profileId });
      return json({ success: true });
    }

    if (action === 'password') {
      const password = String(body.password || '');
      if (password.length < 8) return json({ error: 'Mot de passe : 8 caractères minimum' }, 400);
      const { error } = await admin.auth.admin.updateUserById(profileId, { password });
      if (error) return json({ error: error.message }, 400);
      await admin.rpc('revoke_user_sessions', { target_user_id: profileId });
      return json({ success: true });
    }

    if (action === 'delete') {
      const { error } = await admin.auth.admin.deleteUser(profileId);
      if (error) return json({ error: error.message }, 400);
      await admin.from('profiles').delete().eq('id', profileId);
      return json({ success: true });
    }

    return json({ error: 'Action inconnue' }, 400);
  } catch (err) {
    console.error('manage-staff: erreur', err instanceof Error ? err.stack || err.message : err);
    return json({ error: err instanceof Error ? err.message : 'Erreur inconnue' }, 500);
  }
});
