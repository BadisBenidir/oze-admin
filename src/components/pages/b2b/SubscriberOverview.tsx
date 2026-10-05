import React from 'react';
import {
  Mail, Phone, MapPin, Scale, CalendarClock, CreditCard, ExternalLink, Edit, ShoppingBag, Wallet, EyeOff, Key,
} from 'lucide-react';
import { Card, CardContent } from '../../ui/Card';
import { Badge } from '../../ui/Badge';
import type { Reseller, ResellerContact } from '../../../hooks/useResellers';
import { PERIOD, PLANS } from '../../landing/plans';
import { whatsappUrl } from '../../../utils/whatsapp';

/**
 * Onglet « Profil & abonnement » de la fiche d'un abonné Club B2B (compte
 * unique, jamais de sous-comptes) : coordonnées, statut juridique et
 * abonnement Stripe, avec les actions du compte en boutons.
 */

const PLAN_NAME: Record<string, string> = { drops: 'Pass Drops', revendeur: 'Pass Revendeur' };
const planPrice = (id: string | null | undefined) => PLANS.find((p) => p.id === id)?.price || '';
const formatDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '—';

const LEGAL_STATUS: Record<string, string> = {
  individual: 'Particulier',
  sole_proprietorship: 'Entreprise individuelle (EI)',
  company: 'Société',
};

const subscriptionBadge = (reseller: Reseller) => {
  if (reseller.status === 'pending') return <Badge variant="warning">Paiement non finalisé</Badge>;
  if (reseller.subscription_status === 'past_due') return <Badge variant="danger">Paiement en échec</Badge>;
  if (reseller.subscription_cancel_at_period_end) return <Badge variant="warning">Résiliation programmée</Badge>;
  if (reseller.status === 'suspended') return <Badge variant="danger">Terminé</Badge>;
  return <Badge variant="success">Actif</Badge>;
};

const Row: React.FC<{ icon: React.ElementType; label: string; children: React.ReactNode }> = ({ icon: Icon, label, children }) => (
  <div className="flex items-start gap-3 py-2.5">
    <Icon className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400" />
    <div className="min-w-0">
      <p className="text-xs text-gray-500">{label}</p>
      <div className="text-sm text-gray-900">{children}</div>
    </div>
  </div>
);

interface SubscriberOverviewProps {
  reseller: Reseller;
  contact: ResellerContact | null;
  onEdit: () => void;
  onViewOrders: () => void;
  onViewWallet: () => void;
  onToggleHideIdentity: () => void;
  onResetPassword: () => void;
}

export const SubscriberOverview: React.FC<SubscriberOverviewProps> = ({
  reseller, contact, onEdit, onViewOrders, onViewWallet, onToggleHideIdentity, onResetPassword,
}) => {
  const email = contact?.email || reseller.contact_email;
  const phone = contact?.phone || reseller.contact_phone;
  const billing = [reseller.address, [reseller.postal_code, reseller.city].filter(Boolean).join(' '), reseller.country]
    .filter(Boolean)
    .join(', ');
  const plan = reseller.subscription_plan;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Coordonnées */}
        <Card>
          <CardContent className="p-5">
            <h4 className="mb-1 text-sm font-semibold text-gray-900">Coordonnées</h4>
            <div className="divide-y divide-gray-100">
              <Row icon={Mail} label="Email">
                {email ? <a href={`mailto:${email}`} className="hover:underline">{email}</a> : '—'}
              </Row>
              <Row icon={Phone} label="Téléphone">
                {phone ? <a href={whatsappUrl(phone) || `tel:${phone}`} target="_blank" rel="noreferrer" title="Ouvrir la discussion WhatsApp" className="hover:underline">{phone}</a> : '—'}
              </Row>
              <Row icon={MapPin} label="Adresse de facturation">{billing || '—'}</Row>
              <Row icon={Scale} label="Statut juridique">
                {contact?.legal_status ? (
                  <div className="space-y-0.5">
                    <p>{LEGAL_STATUS[contact.legal_status] || contact.legal_status}</p>
                    {contact.legal_entity_name && <p className="text-xs text-gray-600">{contact.legal_entity_name}{contact.legal_form ? ` (${contact.legal_form})` : ''}</p>}
                    {contact.siret && <p className="font-mono text-xs text-gray-600">SIRET {contact.siret}</p>}
                    {contact.vat_number && <p className="font-mono text-xs text-gray-600">TVA {contact.vat_number}</p>}
                  </div>
                ) : (
                  <span className="text-amber-700">Pas encore renseigné (requis pour acheter)</span>
                )}
              </Row>
              <Row icon={CalendarClock} label="Inscrit le">{formatDate(reseller.created_at)}</Row>
            </div>
          </CardContent>
        </Card>

        {/* Abonnement */}
        <Card>
          <CardContent className="p-5">
            <div className="mb-3 flex items-start justify-between gap-3">
              <h4 className="text-sm font-semibold text-gray-900">Abonnement</h4>
              {subscriptionBadge(reseller)}
            </div>
            <p className="text-lg font-semibold text-gray-900">{plan ? PLAN_NAME[plan] : '—'}</p>
            {plan && <p className="text-sm text-gray-500">{planPrice(plan)} {PERIOD} · sans engagement</p>}

            <div className="mt-3 divide-y divide-gray-100">
              <Row icon={CalendarClock} label={reseller.subscription_cancel_at_period_end ? 'Accès coupé le' : 'Prochain renouvellement'}>
                {formatDate(reseller.subscription_current_period_end)}
              </Row>
              {reseller.subscription_pending_plan && (
                <Row icon={CreditCard} label="Changement programmé">
                  Passage au {PLAN_NAME[reseller.subscription_pending_plan]} à la prochaine échéance
                </Row>
              )}
              <Row icon={CreditCard} label="Statut Stripe">{reseller.subscription_status || '—'}</Row>
            </div>

            {(reseller.stripe_customer_id || reseller.stripe_subscription_id) && (
              <div className="mt-3 flex flex-wrap gap-2">
                {reseller.stripe_customer_id && (
                  <a
                    href={`https://dashboard.stripe.com/customers/${reseller.stripe_customer_id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                  >
                    <ExternalLink className="h-3.5 w-3.5" /> Client Stripe
                  </a>
                )}
                {reseller.stripe_subscription_id && (
                  <a
                    href={`https://dashboard.stripe.com/subscriptions/${reseller.stripe_subscription_id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                  >
                    <ExternalLink className="h-3.5 w-3.5" /> Abonnement Stripe
                  </a>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Actions du compte */}
      {contact && (
        <Card>
          <CardContent className="flex flex-wrap gap-2 p-4">
            <button onClick={onEdit} className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
              <Edit className="h-4 w-4" /> Modifier le compte
            </button>
            <button onClick={onViewOrders} className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
              <ShoppingBag className="h-4 w-4" /> Commandes
            </button>
            <button onClick={onViewWallet} className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
              <Wallet className="h-4 w-4" /> Portefeuille
            </button>
            <button
              onClick={onToggleHideIdentity}
              className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${contact.hide_identity ? 'border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100' : 'border-gray-200 text-gray-700 hover:bg-gray-50'}`}
            >
              <EyeOff className="h-4 w-4" /> {contact.hide_identity ? 'Identité masquée' : "Masquer l'identité"}
            </button>
            <button onClick={onResetPassword} className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
              <Key className="h-4 w-4" /> Nouveau mot de passe
            </button>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default SubscriberOverview;
