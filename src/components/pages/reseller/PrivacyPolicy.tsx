import React, { useEffect } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Card, CardContent } from '../../ui/Card';
import {
  COMPANY_LEGAL_NAME,
  COMPANY_SHARE_CAPITAL,
  COMPANY_RCS,
  COMPANY_ADDRESS,
  COMPANY_CONTACT_EMAIL,
  PRIVACY_VERSION,
} from '../../../config/legal';

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="space-y-2">
    <h4 className="text-sm font-semibold text-gray-900">{title}</h4>
    <div className="text-sm text-gray-600 leading-relaxed space-y-2">{children}</div>
  </div>
);

/**
 * Politique de confidentialité du portail B2B (/confidentialite, lisible sans
 * compte comme /cgv). La liste des destinataires reflète les services tiers
 * réellement utilisés par le code (hébergement, paiement, emails, expédition,
 * facturation, autocomplétion d'adresse) : à mettre à jour, avec
 * PRIVACY_VERSION (config/legal.ts), à chaque ajout ou retrait d'un prestataire.
 */
export const PrivacyPolicy: React.FC = () => {
  useEffect(() => {
    window.scrollTo(0, 0);
    document.querySelector('main')?.scrollTo(0, 0);
    document.title = 'Politique de confidentialité – OZË Paris';
  }, []);

  return (
    <div className="max-w-4xl mx-auto w-full px-4 py-8">
      <div className="flex items-center gap-2 mb-1">
        <ShieldCheck className="h-5 w-5 text-gray-400" />
        <h3 className="text-lg font-semibold text-gray-900">Politique de confidentialité</h3>
      </div>
      <p className="text-xs text-gray-400 mb-6">Version du {PRIVACY_VERSION}</p>

      <Card>
        <CardContent className="p-6 space-y-6">
          <Section title="1. Responsable du traitement">
            <p>
              {COMPANY_LEGAL_NAME} au capital de {COMPANY_SHARE_CAPITAL} €, {COMPANY_RCS}, {COMPANY_ADDRESS}. Contact
              pour toute question relative à vos données : {COMPANY_CONTACT_EMAIL}.
            </p>
          </Section>

          <Section title="2. Données collectées">
            <ul className="list-disc pl-5 space-y-1">
              <li>
                Données d'identification et de contact : nom, prénom, email, téléphone, adresse de livraison et de
                facturation.
              </li>
              <li>
                Données professionnelles : statut (particulier, EI, société), raison sociale, numéro SIRET, numéro de
                TVA intracommunautaire.
              </li>
              <li>
                Données de compte et d'usage : identifiants de connexion, pass souscrit, historique des commandes,
                enchères portées, solde du portefeuille B2B, demandes de sourcing et échanges avec notre équipe.
              </li>
              <li>
                Données de paiement : traitées directement par notre prestataire Stripe. OZË Paris ne stocke jamais vos
                numéros de carte bancaire.
              </li>
              <li>Données techniques : adresse IP, journaux de connexion, type de navigateur.</li>
            </ul>
          </Section>

          <Section title="3. Finalités et bases légales">
            <ul className="list-disc pl-5 space-y-1">
              <li>
                Création et gestion du compte, traitement des commandes, des enchères, des abonnements et des
                livraisons : exécution du contrat.
              </li>
              <li>Facturation et obligations comptables et fiscales : obligation légale.</li>
              <li>
                Prévention de la fraude, sécurité du portail, gestion des retours et des litiges : intérêt légitime.
              </li>
              <li>
                Envoi d'informations sur les drops, enchères et nouveautés : intérêt légitime pour les clients
                professionnels ; consentement pour les clients particuliers. Vous pouvez vous désinscrire à tout moment
                via le lien présent dans chaque email.
              </li>
            </ul>
          </Section>

          <Section title="4. Destinataires">
            <p>
              Vos données sont destinées à l'équipe OZË Paris et à nos sous-traitants, dans la stricte limite de leurs
              missions :
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Vercel : hébergement du portail et mesure d'audience des pages publiques (Vercel Web Analytics) ;</li>
              <li>
                Supabase : base de données, authentification et stockage des fichiers, sur des serveurs situés dans
                l'Union européenne (Francfort, Allemagne) ;
              </li>
              <li>Stripe : paiement des commandes et des abonnements ;</li>
              <li>Resend : envoi des emails (confirmations, factures, notifications) ;</li>
              <li>Sendcloud : création des étiquettes d'expédition et suivi des colis ;</li>
              <li>Qonto : émission des factures ;</li>
              <li>Google (Google Maps Platform) : saisie assistée des adresses ;</li>
            </ul>
            <p>
              ainsi que les transporteurs chargés des livraisons. Elles ne sont jamais vendues ni louées à des tiers.
            </p>
          </Section>

          <Section title="5. Transferts hors de l'Union européenne">
            <p>
              Certains prestataires (Stripe, Vercel, Resend et Google) peuvent traiter des données aux États-Unis. Ces
              transferts sont encadrés par le Data Privacy Framework UE–États-Unis et/ou par les clauses contractuelles
              types de la Commission européenne.
            </p>
          </Section>

          <Section title="6. Durées de conservation">
            <ul className="list-disc pl-5 space-y-1">
              <li>
                Données de compte : pendant toute la durée du compte, puis 3 ans après le dernier contact à des fins de
                prospection.
              </li>
              <li>Factures et pièces comptables : 10 ans (article L123-22 du Code de commerce).</li>
              <li>
                Données liées à un litige : jusqu'à la fin de la procédure et l'expiration des délais de recours.
              </li>
              <li>Journaux de connexion : 12 mois.</li>
            </ul>
          </Section>

          <Section title="7. Vos droits">
            <p>
              Conformément au RGPD et à la loi Informatique et Libertés, vous disposez des droits d'accès, de
              rectification, d'effacement, de limitation, d'opposition et de portabilité de vos données, ainsi que du
              droit de définir des directives relatives à leur sort après votre décès. Pour les exercer :{' '}
              {COMPANY_CONTACT_EMAIL}. Une réponse vous sera apportée dans un délai d'un mois. Vous pouvez également
              introduire une réclamation auprès de la CNIL (www.cnil.fr).
            </p>
          </Section>

          <Section title="8. Cookies">
            <p>
              Le portail utilise uniquement des cookies et technologies de stockage strictement nécessaires à son
              fonctionnement (authentification, maintien de la session). Ils ne nécessitent pas votre consentement.
            </p>
            <p>
              Les pages publiques (accueil et inscription) utilisent par ailleurs la mesure d'audience Vercel Web
              Analytics, qui ne dépose aucun cookie et ne produit que des statistiques de fréquentation agrégées.
            </p>
          </Section>

          <Section title="9. Sécurité">
            <p>
              OZË Paris met en œuvre des mesures techniques et organisationnelles appropriées pour protéger vos
              données : connexions chiffrées (HTTPS), accès restreint aux seules personnes habilitées, contrôle d'accès
              aux bases de données.
            </p>
          </Section>

          <Section title="10. Modification">
            <p>Cette politique peut être mise à jour. La date de la dernière version figure en haut de page.</p>
          </Section>
        </CardContent>
      </Card>
    </div>
  );
};

export default PrivacyPolicy;
