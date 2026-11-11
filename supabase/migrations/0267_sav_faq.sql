-- ============================================================================
-- SAV : FAQ validée pour le chatbot (remplace les 8 entrées de 0263).
--
--   sav_knowledge_base.category   : rubrique (regroupement dans l'admin et
--                                   dans le prompt du bot)
--   sav_knowledge_base.bot_notes  : consignes de comportement ([BOT]) —
--                                   transmises au modèle comme instructions,
--                                   jamais comme texte à montrer au client.
--   content                       : réponse type, au vouvoiement.
-- ============================================================================

alter table public.sav_knowledge_base add column if not exists category text not null default 'Général';
alter table public.sav_knowledge_base add column if not exists bot_notes text not null default '';

delete from public.sav_knowledge_base;

insert into public.sav_knowledge_base (category, title, content, bot_notes, position) values
-- Authenticité et certificat Entrupy
('Authenticité et certificat Entrupy', 'Vos pièces sont-elles authentiques ?',
 $q$Oui. Chaque pièce passe par 3 contrôles : dans les maisons d'enchères japonaises où nous l'achetons, chez nos partenaires au Japon avant l'expédition, puis dans nos locaux en France avant l'envoi.$q$,
 '', 100),
('Authenticité et certificat Entrupy', 'J''ai un doute sur l''authenticité de ma pièce.',
 $q$Nous vous proposons un retour gratuit et un contrôle Entrupy gratuit :
- si la pièce n'est pas authentique, vous êtes remboursé intégralement (garantie AACD) ;
- si Entrupy confirme qu'elle est authentique, les frais d'envoi et le contrôle Entrupy restent à votre charge.
Toute pièce authentifiée par Entrupy n'est pas contestable.$q$,
 $q$Ouvre un ticket (situation « doute_authenticite » : Authenticité, priorité haute) après avoir obtenu le numéro de commande, la pièce concernée et la raison du doute (photos si possible). Si la pièce a déjà un certificat Entrupy (voir get_commande), rappelle qu'elle n'est pas contestable.$q$, 110),
('Authenticité et certificat Entrupy', 'Qu''est-ce que le certificat Entrupy ?',
 $q$Entrupy est un service d'authentification par analyse microscopique et intelligence artificielle, reconnu dans la revente de luxe. C'est une option facultative à 19,90 € par article. Elle vous fournit un certificat à joindre lors de la revente.$q$,
 '', 120),
('Authenticité et certificat Entrupy', 'Puis-je ajouter le certificat Entrupy après ma commande ?',
 $q$Oui, tant que vous n'avez pas fait votre demande de livraison. Après, ce n'est plus possible.$q$,
 '', 130),

-- État des pièces et grades
('État des pièces et grades', 'Que signifient les grades ?',
 $q$- S : neuf ou jamais porté
- A : excellent état, très légères traces
- AB : très bon état, légères traces d'usage
- B : bon état, traces d'usage visibles
- BC : état correct, usure marquée par endroits
- C : usure importante
- D : pièce à restaurer$q$,
 '', 200),
('État des pièces et grades', 'La pièce reçue ne correspond pas au grade ou aux photos.',
 $q$Envoyez-nous des photos avec le numéro de commande. Notre équipe compare avec les photos d'origine et revient vers vous.$q$,
 $q$Demande le numéro de commande et des photos, puis ouvre un ticket (situation « non_conforme » : Commande / livraison, priorité normale).$q$, 210),
('État des pièces et grades', 'Puis-je avoir plus de photos d''une pièce ?',
 $q$Nous ne proposons pas de photos supplémentaires. Les photos et descriptions sont contractuelles : elles sont prises directement auprès des maisons de ventes japonaises.$q$,
 $q$Pas de ticket.$q$, 220),

-- Délais et livraison
('Délais et livraison', 'Quand vais-je recevoir ma commande ?',
 $q$Nos pièces sont achetées au Japon. Comptez au maximum 2 semaines jusqu'à leur arrivée dans nos locaux en France, puis 3 jours maximum de contrôle et d'expédition, puis 2 à 4 jours ouvrés de livraison, soit environ 1 à 3 semaines au total.$q$,
 '', 300),
('Délais et livraison', 'Où en est ma commande ?',
 '',
 $q$Consulte la commande du client connecté (get_mes_commandes / get_commande) et donne son statut simplement. Une pièce « Prêt à expédier » attend la demande de livraison du client : explique-lui comment la faire (voir « Comment demander la livraison »). Si une pièce est bloquée au-delà des délais (plus de 2 semaines en « Commandé » après le paiement, ou plus de 3 jours en « Livraison demandée » / « En préparation » sans expédition), ouvre un ticket (situation « commande_bloquee »).$q$, 310),
('Délais et livraison', 'Comment demander la livraison de ma commande ?',
 $q$Vos pièces restent stockées chez nous jusqu'à votre demande de livraison : vous choisissez quand les recevoir et vous pouvez regrouper plusieurs pièces dans un même colis.
1. Allez dans « Mon compte » (en haut à droite), puis « Mes commandes ».
2. Les pièces arrivées et contrôlées en France apparaissent dans l'encadré « Prêts à être expédiés » en haut de la page.
3. Cochez les pièces à recevoir (ou « Tout sélectionner »), puis cliquez sur « Demander la livraison ».
4. Choisissez la livraison à domicile ou en point relais, indiquez votre numéro de téléphone (demandé par le transporteur) et, si besoin, des consignes de livraison.
5. Réglez les frais de port par carte : la demande est enregistrée et le numéro de suivi apparaît ensuite dans « Mes commandes ».$q$,
 $q$Si le client ne voit pas sa pièce dans « Prêts à être expédiés », consulte sa commande avec get_commande : si la pièce est encore « Commandé », elle est en route depuis le Japon et apparaîtra dès son arrivée et son contrôle en France (rappelle les délais) ; si elle est « Livraison demandée », « En préparation », « Expédié » ou « Livré », la livraison est déjà demandée ou en cours (donne le suivi s'il existe). Pas de ticket, sauf si la pièce est bloquée au-delà des délais.$q$, 315),
('Délais et livraison', 'Livrez-vous hors de France ?',
 $q$Oui, en France et dans l'Union européenne.$q$,
 '', 320),
('Délais et livraison', 'Combien coûte la livraison ?',
 $q$Entre 5,90 € et 19,90 € selon le nombre d'articles. Le montant exact s'affiche lors de votre demande de livraison. Envoi par Colissimo ou Mondial Relay.$q$,
 '', 330),
('Délais et livraison', 'Les frais de douane sont-ils inclus ?',
 $q$Oui : nos prix incluent le transport depuis le Japon, les droits de douane et les taxes. Vous n'avez rien à payer à la réception.$q$,
 '', 340),
('Délais et livraison', 'Mon colis est perdu, en retard ou abîmé.',
 $q$Ne refusez pas le colis s'il est abîmé : prenez des photos du carton et de la pièce dès l'ouverture.$q$,
 $q$Demande le numéro de commande et les photos (carton et pièce), puis ouvre un ticket (situation « colis_perdu_abime » : Colis endommagé ou perdu, priorité haute).$q$, 350),

-- Paiement et factures
('Paiement et factures', 'Quels moyens de paiement acceptez-vous ?',
 $q$Carte bancaire (Visa, Mastercard…), Apple Pay et Google Pay, avec un paiement sécurisé par Stripe. Pas de paiement en plusieurs fois ni de virement.$q$,
 '', 400),
('Paiement et factures', 'Mon paiement a échoué.',
 $q$Vérifiez le plafond de votre carte et la validation 3D Secure auprès de votre banque, puis réessayez.$q$,
 $q$Si le problème persiste, ou si le client a été débité sans confirmation de commande (ou deux fois), ouvre un ticket (situation « probleme_paiement » : Paiement, priorité haute).$q$, 410),
('Paiement et factures', 'Puis-je avoir une facture ?',
 '',
 $q$Utilise l'outil get_facture avec le numéro de la commande (demande-le, ou propose les commandes payées récentes via get_mes_commandes). La facture s'affiche en PDF dans la conversation et part par email : dis-le au client.$q$, 420),
('Paiement et factures', 'Pourquoi n''y a-t-il pas de TVA sur ma facture ?',
 $q$OZË Paris bénéficie de la franchise en base de TVA : nos factures portent la mention « TVA non applicable, art. 293 B du CGI ». Il n'y a donc pas de TVA à récupérer.$q$,
 '', 430),

-- Retours et remboursements
('Retours et remboursements', 'Puis-je retourner une pièce ?',
 '',
 $q$Arbre de décision obligatoire.
1. Statut du client : utilise le statut juridique du profil (donné dans le contexte). S'il est inconnu, demande : « Achetez-vous en tant que particulier ou en tant que professionnel (EI ou société) ? »
2. Particulier : réponds « En principe, nous n'acceptons pas les retours, mais je transmets votre demande à notre équipe qui l'étudiera. », demande le numéro de commande, le motif et des photos, puis ouvre un ticket (situation « retour_particulier » : Retour / remboursement, priorité normale).
3. EI ou société : demande « Votre demande concerne-t-elle un doute sur l'authenticité ou un problème d'état de la pièce ? »
   - Non : réponds « Les retours ne sont pas possibles pour les achats professionnels, en dehors d'un problème d'authenticité ou d'état. » et n'ouvre AUCUN ticket.
   - Authenticité : applique la procédure « J'ai un doute sur l'authenticité » (retour et contrôle Entrupy gratuits, situation « doute_authenticite »).
   - État : demande le numéro de commande et des photos, puis ouvre un ticket (situation « retour_pro_etat »).$q$, 500),
('Retours et remboursements', 'Quand serai-je remboursé ?',
 $q$Une fois le remboursement validé, il est crédité immédiatement sur votre solde OZË. Si vous préférez un remboursement sur votre compte bancaire, faites-en la demande à contact@ozeparis.com : il est effectué sous 14 jours ouvrés après réception de la pièce.$q$,
 $q$Ne dis jamais qu'un remboursement est accepté ou refusé : seule l'équipe en décide.$q$, 510),

-- Abonnement Club B2B
('Abonnement Club B2B', 'Quelles formules proposez-vous ?',
 $q$- Pass Drops, 49,90 €/mois : le drop hebdomadaire + le catalogue en achat immédiat pour les articles semi-luxe.
- Pass Revendeur, 79,90 €/mois : tout le Pass Drops + le sourcing sur mesure + les enchères.$q$,
 '', 600),
('Abonnement Club B2B', 'Quand ont lieu les drops et les enchères ?',
 $q$Un drop chaque mercredi soir et une session d'enchères le vendredi de 13 h à 20 h, parfois d'autres sessions dans la semaine. Les enchères démarrent toujours à 0 €.$q$,
 '', 610),
('Abonnement Club B2B', 'Comment résilier mon abonnement ?',
 $q$L'abonnement est sans engagement : résiliez-le à tout moment directement sur votre profil. Votre accès reste actif jusqu'à la fin de la période déjà payée, sans remboursement au prorata.$q$,
 '', 620),
('Abonnement Club B2B', 'Je fais partie d''un accompagnement partenaire, ai-je une réduction ?',
 $q$Certains programmes partenaires donnent droit à une réduction sur le Pass Revendeur.$q$,
 $q$Demande le nom du programme partenaire, puis ouvre un ticket (situation « abonnement ») pour que l'équipe vérifie et applique la réduction.$q$, 630),
('Abonnement Club B2B', 'J''ai été débité après ma résiliation / mon accès ne fonctionne pas.',
 '',
 $q$Vérifie le statut de l'abonnement avec get_mon_abonnement, puis ouvre un ticket (situation « abonnement »).$q$, 640),

-- Sourcing sur mesure
('Sourcing sur mesure', 'Questions sur le sourcing sur mesure',
 $q$Pour le sourcing sur mesure, notre équipe vous répond directement sur WhatsApp au +33 7 43 70 17 34 : https://wa.me/33743701734$q$,
 $q$Pour TOUTE question sur le sourcing sur mesure (nouvelle demande, recherche d'une pièce précise à trouver, délais, suivi, retrait d'une pièce), ne réponds pas sur le fond et n'ouvre pas de ticket : réponds uniquement par ce message, avec le lien https://wa.me/33743701734 tel quel.$q$, 700);

notify pgrst, 'reload schema';
