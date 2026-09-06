import React, { useEffect, useState } from 'react';
import { Scale, FileText, User, Briefcase, Building2 } from 'lucide-react';
import { Card, CardContent } from '../../ui/Card';
import {
  COMPANY_LEGAL_NAME,
  COMPANY_SIRET,
  COMPANY_RCS,
  COMPANY_JURISDICTION_CITY,
  COMPANY_ADDRESS,
  MEDIATOR_NAME,
  MEDIATOR_URL,
  CGV_VERSION,
} from '../../../config/legal';

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
                  Conformément à l'article 297 A du Code Général des Impôts, les ventes de biens d'occasion sont
                  susceptibles d'être soumises au régime de la TVA sur la marge : la TVA n'est alors ni mentionnée sur la
                  facture ni récupérable par l'acheteur assujetti.
                </p>
              </Section>
              <Section title="2. Commande et prix">
                <p>
                  Toute commande passée sur le portail, ainsi que toute adjudication d'une enchère en ligne, vaut
                  acceptation ferme des prix et des présentes conditions applicables au statut déclaré par le client.
                  Les prix sont exprimés en euros, toutes taxes comprises le cas échéant.
                </p>
              </Section>
              <Section title="3. Modalités de paiement">
                <p>
                  Le paiement s'effectue par carte bancaire (prestataire Stripe), par solde du portefeuille B2B, ou par
                  combinaison des deux. La commande n'est confirmée qu'après encaissement effectif du paiement.
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
              </Section>
              <Section title="Garanties légales">
                <p>
                  Le client particulier bénéficie de la garantie légale de conformité (articles L217-3 et suivants du
                  Code de la consommation) et de la garantie légale contre les vices cachés (articles 1641 et suivants
                  du Code civil).
                </p>
              </Section>
              <Section title="Médiation de la consommation">
                <p>
                  En cas de litige non résolu directement avec OZË Paris, le client particulier peut recourir
                  gratuitement au service de médiation de la consommation : {MEDIATOR_NAME} ({MEDIATOR_URL}).
                </p>
              </Section>
            </>
          )}

          {(tab === 'sole_proprietorship' || tab === 'company') && (
            <>
              <Section title="Absence de droit de rétractation">
                <p>
                  Le client ayant déclaré le statut {tab === 'company' ? 'Société' : 'Entreprise Individuelle (EI)'}{' '}
                  achète à titre professionnel pour les besoins de son activité (revente, constitution de stock,
                  shooting, investissement). Conformément à l'article L221-3 a contrario du Code de la consommation, le
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
              <Section title="Transfert des risques">
                <p>
                  Les risques de perte ou d'endommagement sont transférés au client dès la remise du colis au
                  transporteur, conformément à l'article L216-4 du Code de la consommation (inapplicable aux
                  professionnels) et aux dispositions de droit commun régissant la vente entre professionnels.
                </p>
              </Section>
              <Section title="Facturation">
                <p>
                  Le client s'engage à fournir un numéro SIRET valide, exigible avant toute génération de facture. Un
                  client EI relevant de la franchise en base de TVA fait figurer sur sa facture la mention légale
                  "TVA non applicable, article 293 B du Code Général des Impôts".
                </p>
              </Section>
              <Section title="Juridiction compétente">
                <p>
                  Tout litige né de l'exécution ou de l'interprétation des présentes relève de la compétence exclusive
                  des tribunaux du ressort du siège social d'OZË Paris ({COMPANY_JURISDICTION_CITY}), y compris en cas
                  de pluralité de défendeurs ou d'appel en garantie.
                </p>
              </Section>
            </>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-gray-400 mt-6">
        {COMPANY_LEGAL_NAME} — SIRET {COMPANY_SIRET} — {COMPANY_RCS} — {COMPANY_ADDRESS}
      </p>
    </div>
  );
};

export default Terms;
