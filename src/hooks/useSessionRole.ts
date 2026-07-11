import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

interface SessionRoleState {
  status: 'loading' | 'signed-out' | 'signed-in';
  role: string | null;
}

export const useSessionRole = () => {
  const [state, setState] = useState<SessionRoleState>({ status: 'loading', role: null });

  useEffect(() => {
    let mounted = true;

    const resolveRole = async (session: import('@supabase/supabase-js').Session | null) => {
      if (!session?.user) {
        if (mounted) setState({ status: 'signed-out', role: null });
        return;
      }

      const { data } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', session.user.id)
        .single();

      if (!mounted) return;
      setState({ status: 'signed-in', role: data?.role ?? null });
    };

    supabase.auth.getSession().then(({ data: { session } }) => resolveRole(session));

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      resolveRole(session);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  return state;
};
