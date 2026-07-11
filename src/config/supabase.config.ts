// Configuration temporaire Supabase pour debug
export const SUPABASE_CONFIG = {
  // Remplacez par vos vraies valeurs Supabase
  url: import.meta.env.VITE_SUPABASE_URL || 'https://votre-projet.supabase.co',
  anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY || 'votre-clé-anon'
}

// Log pour debug
console.log('Config Supabase chargée:', {
  url: SUPABASE_CONFIG.url,
  anonKey: SUPABASE_CONFIG.anonKey ? 'DÉFINI' : 'MANQUANT'
})