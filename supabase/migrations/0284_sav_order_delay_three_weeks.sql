-- SAV chatbot, « Où en est ma commande ? » : ticket « commande bloquée »
-- seulement après 3 semaines (21 jours) en « Commandé » ; avant, message
-- d'attente (contrôles de douane), sans ticket. jours_depuis_commande est
-- fourni par les outils get_mes_commandes / get_commande (sav-chat).

update public.sav_knowledge_base
set bot_notes = 'Consulte la commande du client connecté (get_mes_commandes / get_commande) et donne son statut simplement. Une pièce « Prêt à expédier » attend la demande de livraison du client : explique-lui comment la faire (voir « Comment demander la livraison »).'
  || E'\n' || 'Pièce encore en « Commandé » : regarde jours_depuis_commande. Moins de 21 jours : N''ouvre PAS de ticket et réponds en substance : « Il arrive que certaines commandes mettent plus de temps en raison des fréquents contrôles de douane. Désolé pour cela et merci de votre patience : votre commande passera en « Prêt à expédier » dès qu''elle sera prête à être réexpédiée. » 21 jours ou plus : ouvre un ticket (situation « commande_bloquee »).'
  || E'\n' || 'Plus de 3 jours en « Livraison demandée » / « En préparation » sans expédition : ouvre un ticket (situation « commande_bloquee »).',
    updated_at = now()
where id = 'be22cd41-9aa3-443a-b4b8-5460c22a3602';
