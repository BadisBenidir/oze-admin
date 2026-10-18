import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { supabase } from './lib/supabase';

// « Voir son espace » (admin → impersonate-member) : le lien ouvre le portail
// avec un jeton de connexion à usage unique dans le fragment de l'URL. On le
// valide avant d'afficher l'application, puis on le retire de l'adresse.
const consumeMemberAccess = async () => {
  const match = window.location.hash.match(/oze_member_access=([^&]+)/);
  if (!match) return;
  window.history.replaceState({}, '', window.location.pathname + window.location.search);
  const { error } = await supabase.auth.verifyOtp({ token_hash: decodeURIComponent(match[1]), type: 'magiclink' });
  if (error) console.error('Accès membre : lien invalide ou expiré', error.message);
};

consumeMemberAccess().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
});
