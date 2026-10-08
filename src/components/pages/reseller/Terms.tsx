import React, { useEffect, useState } from 'react';
import { Scale, FileText, User, Briefcase, Building2 } from 'lucide-react';
import { Card, CardContent } from '../../ui/Card';
import {
  COMPANY_LEGAL_NAME,
  COMPANY_SHARE_CAPITAL,
  COMPANY_SIRET,
  COMPANY_RCS,
  COMPANY_JURISDICTION_CITY,
  COMPANY_ADDRESS,
  COMPANY_VAT_NUMBER,
  MEDIATOR_NAME,
  MEDIATOR_URL,
  CGV_VERSION,
} from '../../../config/legal';
import { PERIOD, PLANS } from '../../landing/plans';

const passPrice = (id: 'drops' | 'revendeur') => PLANS.find((p) => p.id === id)?.price || '';

type TermsTab = 'common' | 'individual' | 'sole_proprietorship' | 'company';

const TABS: { id: TermsTab; label: string; icon: React.ElementType }[] = [
  { id: 'common', label: 'Clauses communes', icon: FileText },
  { id: 'individual', label: 'Particuliers (B2C)', icon: User },
  { id: 'sole_proprietorship', label: 'Entreprises Individuelles (EI)', icon: Briefcase },
  { id: 'company', label: 'Sociétés (B2B)', icon: Building2 },
];

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="space-y-2">
    <h4 className="text-sm font-semibold text-gray-900">{title}</h4>
    <div className="text-sm text-gray-600 leading-relaxed space-y-2">{children}</div>
  </div>
);

/**
 * CGV/CGU du portail revendeur — trois régimes distincts selon le statut
 * juridique déclaré (voir 0109/ResellerProfile.tsx "Statut juridique") :
 * un particulier bénéficie du droit de rétractation B2C, une EI/société
 * achète ferme et définitif (achat professionnel). Page volontairement
 * statique (pas de CMS) : toute modification substantielle du texte doit
 * s'accompagner d'un bump de CGV_VERSION (config/legal.ts) pour pouvoir
 * redemander un consentement explicite plus tard si besoin.
 */
export const Terms: React.FC = () => {
  const [tab, setTab] = useState<TermsTab>('common');

  // Le lien "CGV" vit dans le pied de page, donc tout en bas de la zone
  // défilable (voir ResellerApp.tsx) — sans ça, la page s'affiche mais reste
  // scrollée là où l'utilisateur a cliqué, donnant l'impression d'arriver
  // "en bas" de la page des CGV. `<main>` défile lui-même (md:overflow-auto,
  // layMainLayout.tsx) : window.scrollTo seul ne suffit pas sur desktop.
  useEffect(() => {
    window.scrollTo(0, 0);
    document.querySelector('main')?.scrollTo(0, 0);
    document.title = 'Conditions générales de vente – OZË Paris';
  }, []);

  return (
    <div className="max-w-4xl mx-auto w-full px-4 py-8">
      <div className="flex items-center gap-2 mb-1">
        <Scale className="h-5 w-5 text-gray-400" />
        <h3 className="text-lg font-semibold text-gray-900">Conditions Générales de Vente et d'Utilisation</h3>
      </div>
      <p className="text-xs text-gray-400 mb-6">Version du {CGV_VERSION} — applicables au portail professionnel OZË Paris.</p>

      <div className="flex flex-wrap gap-2 mb-6">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === id ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      <Card>
        <CardContent className="p-6 space-y-6">
          {tab === 'common' && (
            <>
              <Section title="1. Authenticité et seconde main">
                <p>
                  Chaque pièce de maroquinerie de luxe proposée à la vente fait l'objet d'un contrôle d'authenticité
                  rigoureux avant sa mise en ligne. En cas de doute sur l'authenticité d'un article après réception, le
                  client dispose du recours prévu à la section applicable à son statut ci-dessous.
                </p>
                <p>
                  S'agissant d'articles d'occasion, l'état d'usage (grade, patine, traces d'usure naturelles) est décrit
                  aussi précisément que possible et illustré par des photographies contractuelles. Une usure conforme au
                  grade annoncé ne constitue pas un défaut de conformité.
                </p>
                <p>
                  {COMPANY_LEGAL_NAME} relève du régime de la franchise en base de TVA (article 293 B du Code Général
                  des Impôts) : la TVA n'est pas facturée sur les ventes, conformément à la mention légale "TVA non
                  applicable, art. 293 B du CGI" figurant sur les factures.
                </p>
              </Section>
              <Section title="2. Commande et prix">
                <p>
                  Toute commande passée sur le portail, ainsi que toute adjudication d'une enchère en ligne, vaut
                  acceptation ferme des prix et des présentes conditions applicables au statut déclaré par le client.
                  Les prix sont exprimés en euros, toutes taxes comprises le cas échéant.
                </p>
              </Section>
              <Section title="2 bis. Enchères">
                <p>
                  Toute enchère portée sur le portail est ferme et engage son auteur. L'adjudicataire est tenu de régler
                  le prix dans un délai de 48 heures suivant la clôture de l'enchère. À défaut de paiement dans ce délai,
                  OZË Paris peut annuler l'adjudication, remettre l'article en vente et suspendre l'accès du client aux
                  enchères, sans préjudice de tous dommages et intérêts.
                </p>
              </Section>
              <Section title="3. Modalités de paiement">
                <p>
                  Le paiement s'effectue par carte bancaire (prestataire Stripe), par solde du portefeuille B2B, ou par
                  combinaison des deux. La commande n'est confirmée qu'après encaissement effectif du paiement.
                </p>
                <p>
                  Le solde du portefeuille B2B est utilisable pour tout achat sur le portail. En cas de clôture du compte,
                  le solde non utilisé est remboursé au client sur simple demande à contact@ozeparis.com.
                </p>
              </Section>
              <Section title="4. Livraison">
                <p>
                  Les délais et modalités de livraison sont précisés lors de la demande d'expédition. Le transfert des
                  risques est précisé selon le statut du client à la section applicable ci-dessous.
                </p>
              </Section>
              <Section title="5. Litiges">
                <p>
                  Les présentes conditions sont soumises au droit français. Le tribunal compétent en cas de litige
                  dépend du statut du client, précisé à la section applicable ci-dessous.
                </p>
              </Section>
              <Section title="6. Abonnements Club B2B">
                <p>
                  <strong>6.1 Objet.</strong> L'accès au portail peut être souscrit en ligne sous la forme d'un abonnement
                  (« pass ») : le <strong>Pass Drops</strong> ({passPrice('drops')} {PERIOD}) donne accès au catalogue B2B
                  et aux drops, avec achat à l'unité ; le <strong>Pass Revendeur</strong> ({passPrice('revendeur')} {PERIOD})
                  y ajoute les sessions d'enchères privées et le sourcing sur mesure. Le Pass Boutiques fait l'objet d'une
                  offre sur devis. Le contenu détaillé de chaque pass est présenté sur la page d'inscription.
                </p>
                <p>
                  <strong>6.2 Prix et paiement.</strong> Le prix est payable mensuellement et d'avance par carte bancaire
                  (prestataire Stripe), TVA non applicable (article 293 B du CGI). L'abonnement est reconduit
                  automatiquement chaque mois à sa date anniversaire, sauf résiliation. Une facture est émise à chaque
                  échéance et reste consultable dans « Mon profil » → « Mon abonnement ».
                </p>
                <p>
                  <strong>6.3 Durée et résiliation.</strong> L'abonnement est sans engagement et résiliable à tout moment
                  depuis « Mon profil ». La résiliation prend effet à la fin de la période mensuelle déjà payée, jusqu'à
                  laquelle l'accès est maintenu ; le mois entamé n'est pas remboursé.
                </p>
                <p>
                  <strong>6.4 Changement de pass.</strong> Le passage du Pass Drops au Pass Revendeur est immédiat : la
                  différence de prix est facturée au prorata des jours restants de la période en cours. Le passage du
                  Pass Revendeur au Pass Drops prend effet à la prochaine échéance.
                </p>
                <p>
                  <strong>6.5 Défaut de paiement.</strong> En cas d'échec d'un prélèvement, de nouvelles tentatives sont
                  effectuées automatiquement et le client en est informé par email. À défaut de régularisation, l'accès
                  est suspendu. Les commandes, le solde du portefeuille et les informations du client sont conservés ;
                  l'accès est rétabli dès la souscription d'un nouveau pass.
                </p>
                <p>
                  <strong>6.6 Droit de rétractation.</strong> Le client professionnel (EI, société) ne dispose d'aucun
                  droit de rétractation sur l'abonnement. Le client particulier dispose d'un délai de 14 jours à compter
                  de la souscription (voir l'onglet « Particuliers »).
                </p>
                <p>
                  <strong>6.7 Déclarations infondées.</strong> Lorsqu'un client retourne un article en invoquant un défaut
                  d'authenticité, un défaut non décrit dans l'annonce ou tout autre défaut de conformité, et que ce motif
                  se révèle inexact après vérification par OZË Paris (pièce authentique, défaut mentionné dans la
                  description ou visible sur les photographies, usure conforme au grade annoncé), OZË Paris se réserve le
                  droit de ne pas renouveler l'abonnement du client à l'issue de la période mensuelle en cours. Cette
                  mesure sanctionne la déclaration inexacte et non l'exercice d'un droit de retour ou de rétractation :
                  elle ne prive en aucun cas le client particulier du remboursement qui lui est dû au titre de son droit
                  de rétractation, dans les conditions de l'onglet « Particuliers ».
                </p>
                <p>
                  <strong>6.8 Évolution des prix.</strong> Toute modification du prix d'un pass est notifiée par email au
                  moins 30 jours avant son application ; le client peut résilier avant cette date sans frais.
                </p>
                <p>
                  <strong>6.9 Usage du compte.</strong> Le compte est personnel. Le partage ou la revente de l'accès, la
                  diffusion des contenus réservés ou toute fraude peuvent entraîner la suspension immédiate de l'accès,
                  sans remboursement de la période en cours.
                </p>
              </Section>
              <Section title="7. Responsabilité">
                <p>
                  La responsabilité d'OZË Paris ne saurait être engagée pour les dommages indirects (perte de chiffre
                  d'affaires, perte de marge, perte de chance) subis par un client professionnel. Elle est en tout état
                  de cause limitée au prix de l'article concerné. Cette limitation ne s'applique pas aux clients
                  particuliers.
                </p>
              </Section>
              <Section title="8. Force majeure">
                <p>
                  Aucune des parties ne pourra être tenue responsable d'un manquement résultant d'un cas de force
                  majeure au sens de l'article 1218 du Code civil.
                </p>
              </Section>
              <Section title="9. Propriété intellectuelle">
                <p>
                  Les photographies, descriptions et contenus du portail sont la propriété d'OZË Paris. Toute
                  reproduction ou diffusion, notamment pour la revente des articles sur d'autres plateformes, est
                  interdite sans autorisation écrite préalable.
                </p>
              </Section>
              <Section title="10. Données personnelles">
                <p>
                  Les données collectées sont traitées conformément à notre politique de confidentialité.
                  {/* TODO : page politique de confidentialité à créer, puis remplacer la fin de phrase par
                      « …politique de confidentialité, accessible <a href="…">ici</a>. » */}
                </p>
              </Section>
              <Section title="11. Contact">
                <p>OZË Paris – contact@ozeparis.com – 6 rue d'Armaille, 75017 Paris.</p>
              </Section>
            </>
          )}

          {tab === 'individual' && (
            <>
              <Section title="Droit de rétractation">
                <p>
                  Conformément aux articles L221-18 et suivants du Code de la consommation, le client agissant en
                  qualité de particulier dispose d'un délai de <strong>14 jours calendaires</strong> à compter de la
                  réception du colis pour exercer son droit de rétractation, sans avoir à justifier de motif.
                </p>
                <p>
                  Les frais de retour sont à la charge du client. L'article doit être retourné dans son état exact
                  d'origine, non porté au-delà des vérifications usuelles, avec l'ensemble de ses accessoires et,
                  lorsqu'il en est équipé, son scellé de sécurité (tag) intact et non retiré. Un scellé retiré ou brisé
                  peut entraîner une dépréciation du remboursement à due proportion de la perte de valeur constatée.
                </p>
                <p>
                  Le client peut exercer son droit de rétractation en adressant à contact@ozeparis.com une déclaration
                  dénuée d'ambiguïté ou le formulaire type ci-dessous. OZË Paris rembourse la totalité des sommes
                  versées, frais de livraison initiaux inclus (hors surcoût d'un mode de livraison plus coûteux choisi
                  par le client), dans un délai de 14 jours à compter de la réception de la décision de rétractation. Ce
                  remboursement peut être différé jusqu'à la réception de l'article ou jusqu'à la preuve de son
                  expédition. Le remboursement est effectué par le même moyen de paiement que celui utilisé pour la
                  commande. Le droit de rétractation s'applique également aux articles adjugés lors d'une enchère en
                  ligne sur le portail.
                </p>
              </Section>
              <Section title="Formulaire de rétractation">
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-1.5">
                  <p>
                    À l'attention d'OZE PARIS, SAS, 6 rue d'Armaille, 75017 Paris, contact@ozeparis.com :
                  </p>
                  <p>
                    Je/nous (*) vous notifie/notifions (*) par la présente ma/notre (*) rétractation du contrat portant
                    sur la vente du bien (*)/pour la prestation de services (*) ci-dessous :
                  </p>
                  <p>Commandé le (*)/reçu le (*) :</p>
                  <p>Nom du (des) consommateur(s) :</p>
                  <p>Adresse du (des) consommateur(s) :</p>
                  <p>Signature du (des) consommateur(s) (uniquement en cas de notification du présent formulaire sur papier) :</p>
                  <p>Date :</p>
                  <p className="text-xs">(*) Rayez la mention inutile.</p>
                </div>
              </Section>
              <Section title="Rétractation de l'abonnement Club B2B">
                <p>
                  Le client particulier dispose de <strong>14 jours calendaires</strong> à compter de la souscription d'un
                  pass pour se rétracter, sans avoir à justifier de motif, par email à l'adresse contact@ozeparis.com.
                  L'accès à l'espace est alors fermé et le montant payé pour le pass lui est remboursé dans un délai de
                  14 jours à compter de la réception de sa décision.
                </p>
                <p>
                  Un retour motivé par une déclaration qui se révèle inexacte (authenticité, défaut non décrit) peut
                  entraîner le non-renouvellement de l'abonnement à l'issue de la période en cours, selon l'article 6.7
                  des clauses communes. Le remboursement dû au titre de la rétractation reste intégralement versé.
                </p>
              </Section>
              <Section title="Garanties légales">
                <p>
                  Le client particulier bénéficie de la garantie légale de conformité (articles L217-3 et suivants du
                  Code de la consommation) et de la garantie légale contre les vices cachés (articles 1641 et suivants
                  du Code civil).
                </p>
                <p>
                  S'agissant de biens d'occasion, les défauts de conformité qui apparaissent dans un délai de douze mois
                  à compter de la délivrance sont présumés exister au moment de la délivrance.
                </p>
                {/* TODO : encadré masqué en attendant le texte officiel — le réactiver avec le texte de
                    l'annexe de l'article D211-2 du Code de la consommation (Légifrance) :
                <div className="rounded-lg border border-gray-300 p-4 space-y-2">
                  <p className="font-semibold text-gray-900">Garantie légale de conformité</p>
                  <p>…texte officiel de l'annexe de l'article D211-2…</p>
                </div>
                */}
              </Section>
              <Section title="Livraison et transfert des risques">
                <p>
                  Sauf délai différent indiqué lors de la commande, l'article est livré au plus tard 30 jours après la
                  confirmation de la commande. Le transfert des risques de perte ou d'endommagement intervient au moment
                  où le client, ou un tiers désigné par lui, prend physiquement possession de l'article (article L216-4
                  du Code de la consommation).
                </p>
              </Section>
              <Section title="Résiliation de l'abonnement">
                <p>
                  Le client particulier peut résilier son abonnement à tout moment, gratuitement, depuis « Mon profil »
                  → « Mon abonnement », au moyen de la fonctionnalité de résiliation prévue à l'article L215-1-1 du Code
                  de la consommation.
                </p>
              </Section>
              <Section title="Médiation de la consommation">
                <p>
                  En cas de litige non résolu directement avec OZË Paris, le client particulier peut recourir
                  gratuitement au service de médiation de la consommation : {MEDIATOR_NAME} ({MEDIATOR_URL}).
                </p>
              </Section>
              <Section title="Juridiction compétente">
                <p>
                  En cas de litige, le client particulier peut saisir, à son choix, la juridiction du lieu où il
                  demeurait au moment de la conclusion du contrat ou de la survenance du fait dommageable, ou toute autre
                  juridiction territorialement compétente en vertu du Code de procédure civile (article R631-3 du Code
                  de la consommation).
                </p>
              </Section>
            </>
          )}

          {(tab === 'sole_proprietorship' || tab === 'company') && (
            <>
              <Section title="Absence de droit de rétractation">
                <p>
                  Le client ayant déclaré le statut {tab === 'company' ? 'Société' : 'Entreprise Individuelle (EI)'}{' '}
                  achète à titre professionnel pour les besoins de son activité (revente et constitution de stock).
                  Conformément à l'article L221-3 a contrario du Code de la consommation, le
                  droit de rétractation prévu pour les particuliers ne s'applique pas : la commande ou l'adjudication
                  d'une enchère est ferme et définitive dès sa validation.
                </p>
              </Section>
              <Section title="Réception et réclamations">
                <p>
                  Toute anomalie ou non-conformité de l'article par rapport au bordereau d'expédition doit être signalée
                  par écrit dans un délai de forclusion strict de <strong>48 heures ouvrées</strong> suivant la
                  livraison. Passé ce délai, la marchandise est réputée conforme et acceptée sans réserve.
                </p>
              </Section>
              <Section title="Garantie d'authenticité">
                <p>
                  Si, malgré les contrôles réalisés, un article s'avérait non authentique, le client professionnel est
                  remboursé de l'intégralité du prix payé, dans le cadre de la garantie de l'AACD (association japonaise
                  encadrant le commerce du luxe de seconde main). Toute contestation d'authenticité doit être notifiée
                  par écrit à contact@ozeparis.com dans un délai de 14 jours suivant la livraison, accompagnée d'un
                  rapport d'authentification émanant d'un professionnel reconnu. L'article doit être retourné dans
                  l'état exact où il a été livré, scellé intact le cas échéant.
                </p>
              </Section>
              <Section title="Transfert des risques">
                <p>
                  Par dérogation à l'article 1196 du Code civil, les risques de perte ou d'endommagement sont transférés
                  au client dès la remise du colis au transporteur.
                </p>
              </Section>
              <Section title="Pénalités de retard">
                <p>
                  Le paiement s'effectuant à la commande, aucun délai de paiement n'est accordé. En cas de retard ou
                  d'incident de paiement, des pénalités de retard sont exigibles de plein droit au taux de trois fois le
                  taux d'intérêt légal, ainsi qu'une indemnité forfaitaire pour frais de recouvrement de 40 €.
                </p>
              </Section>
              <Section title="Facturation">
                {tab === 'company' ? (
                  <p>
                    Le client s'engage à fournir un numéro SIRET valide, ou, pour une société établie dans un autre État
                    membre de l'Union européenne, son numéro de TVA intracommunautaire, exigible avant toute génération
                    de facture. Les factures émises par OZE PARIS, SAS portent la mention « TVA non applicable, art. 293
                    B du CGI ».
                  </p>
                ) : (
                  <p>
                    Le client s'engage à fournir un numéro SIRET valide, exigible avant toute génération de facture. Les
                    factures émises par OZE PARIS, SAS portent la mention « TVA non applicable, art. 293 B du CGI ».
                  </p>
                )}
              </Section>
              <Section title="Juridiction compétente">
                <p>
                  Lorsque le client a la qualité de commerçant, tout litige né de l'exécution ou de l'interprétation des
                  présentes relève de la compétence exclusive des tribunaux du ressort du siège social d'OZË Paris
                  ({COMPANY_JURISDICTION_CITY}), y compris en cas de pluralité de défendeurs ou d'appel en garantie.
                </p>
              </Section>
            </>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-gray-400 mt-6">
        {COMPANY_LEGAL_NAME} au capital de {COMPANY_SHARE_CAPITAL} € — SIRET {COMPANY_SIRET} — {COMPANY_RCS} — TVA intracommunautaire {COMPANY_VAT_NUMBER} — {COMPANY_ADDRESS}
      </p>
    </div>
  );
};

export default Terms;
