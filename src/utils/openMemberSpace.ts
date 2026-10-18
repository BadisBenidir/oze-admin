import { invokeEdgeFunction } from './invokeEdgeFunction';

/**
 * « Voir son espace » (propriétaire uniquement, fonction impersonate-member) :
 * ouvre le portail pro connecté en tant que ce membre, dans un nouvel onglet.
 * L'onglet est ouvert AVANT l'appel serveur (sinon le navigateur bloque la
 * fenêtre surgissante), puis redirigé vers le lien de connexion.
 */
export const openMemberSpace = async (profileId: string, memberName: string): Promise<string | null> => {
  if (
    !window.confirm(
      `Ouvrir l'espace de ${memberName} dans un nouvel onglet ?\n\nTu y seras connecté EN TANT QUE ce membre : toute action (achat, enchère, demande de livraison…) sera faite à son nom. À utiliser pour consulter.`
    )
  ) {
    return null;
  }
  const tab = window.open('about:blank', '_blank');
  const { data, error } = await invokeEdgeFunction<{ url?: string }>('impersonate-member', { profile_id: profileId });
  if (error || !data?.url) {
    tab?.close();
    return error || 'Lien de connexion indisponible';
  }
  if (tab) tab.location.href = data.url;
  else window.open(data.url, '_blank');
  return null;
};
