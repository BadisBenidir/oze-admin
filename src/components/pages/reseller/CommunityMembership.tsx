import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, ArrowDownCircle, CalendarClock, CreditCard, Download, ExternalLink, FileText } from 'lucide-react';
import { Card, CardContent } from '../../ui/Card';
import { invokeEdgeFunction } from '../../../utils/invokeEdgeFunction';
import { formatMonthlyPrice } from '../../../hooks/useCommunityGroupPrices';

/**
 * « Mon abonnement » d'un membre de communauté partenaire (0214), dans
 * Mon profil : prix, échéance, carte, factures, changement de carte (portail
 * Stripe), résiliation / reprise, (ré)abonnement. Tout passe par l'Edge
 * Function community-subscription. Un réabonnement après résiliation se fait
 * au prix public des nouveaux membres (groupe 4) si le tarif du membre était
 * inférieur. « Passer au Pass Drops » : à la prochaine échéance, au prix
 * public du Pass Drops, sans enchères ni sourcing (0216).
 */

interface MembershipStatus {
  member_group: number | null;
  public_price: number | null;
  resubscribe: boolean;
  subscribe_price: number | null;
  drops_price?: number | null;
  subscription: {
    plan: 'community' | 'drops';
    pending_plan: 'drops' | null;
    status: string;
    monthly_price: number;
    current_period_end: string | null;
    cancel_at_period_end: boolean;
    started_at: string;
    card: { brand: string; last4: string; exp_month: number; exp_year: number } | null;
  } | null;
}

interface Invoice {
  id: string;
  number: string | null;
  created: string;
  amount: number;
  status: string;
  hosted_invoice_url: string | null;
  invoice_pdf: string | null;
}

const ONGOING = new Set(['active', 'trialing', 'past_due']);

const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : null;

const EUR = (n: number) => n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });

const BRAND: Record<string, string> = { visa: 'Visa', mastercard: 'Mastercard', amex: 'American Express', cartes_bancaires: 'CB' };

export const CommunityMembershipSection: React.FC<{ companyName: string }> = ({ companyName }) => {
  const [status, setStatus] = useState<MembershipStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmDrops, setConfirmDrops] = useState(false);
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [showInvoices, setShowInvoices] = useState(false);
  const justPaid = new URLSearchParams(window.location.search).get('abonnement_membre') === 'ok';

  const load = useCallback(async () => {
    const { data, error: err } = await invokeEdgeFunction<MembershipStatus>('community-subscription', { action: 'status' });
    if (data) setStatus(data);
    else if (err) setError(err);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    // Retour de Stripe : le webhook enregistre l'abonnement en quelques secondes.
    if (!justPaid) return;
    const t = setTimeout(load, 4000);
    return () => clearTimeout(t);
  }, [load, justPaid]);

  const run = async (action: 'checkout' | 'portal' | 'cancel' | 'resume' | 'downgrade' | 'cancel_downgrade') => {
    setPending(action);
    setError(null);
    const { data, error: err } = await invokeEdgeFunction<{ url?: string }>('community-subscription', { action });
    if (data?.url) {
      window.location.href = data.url;
      return;
    }
    setPending(null);
    if (err) return setError(err);
    setConfirmCancel(false);
    setConfirmDrops(false);
    // Changement d'offre : rechargement pour que menus et accès suivent.
    if (action === 'downgrade' || action === 'cancel_downgrade') return window.location.reload();
    load();
  };

  const toggleInvoices = async () => {
    setShowInvoices((v) => !v);
    if (invoices) return;
    const { data } = await invokeEdgeFunction<{ invoices: Invoice[] }>('community-subscription', { action: 'invoices' });
    setInvoices(data?.invoices || []);
  };

  if (loading) {
    return (
      <Card className="mb-6">
        <CardContent className="p-5">
          <div className="h-20 animate-pulse rounded-lg bg-gray-100" />
        </CardContent>
      </Card>
    );
  }

  const sub = status?.subscription;
  const ongoing = Boolean(sub && ONGOING.has(sub.status));
  // Rien à montrer : pas de groupe, pas de prix fixé et jamais abonné.
  if (!status || (!ongoing && !status.subscribe_price && !sub)) {
    return error ? (
      <p className="mb-6 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
        <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" /> {error}
      </p>
    ) : null;
  }

  const endDate = formatDate(sub?.current_period_end ?? null);
  const pastDue = sub?.status === 'past_due';
  const cancelling = Boolean(sub?.cancel_at_period_end);
  const losesDiscount = Boolean(sub && status.public_price && sub.monthly_price < status.public_price);
  const isDrops = sub?.plan === 'drops';
  const dropsScheduled = sub?.pending_plan === 'drops' && !isDrops;
  const dropsPrice = status.drops_price ?? null;

  return (
    <Card className="mb-6">
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h4 className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
              <CreditCard className="h-4 w-4 text-gray-400" /> Mon abonnement
            </h4>
            <p className="mt-2 text-base font-semibold text-gray-900">
              {ongoing && isDrops ? 'Pass Drops OZË PARIS' : `Abonnement OZË PARIS — ${companyName}`}
            </p>
            <p className="text-sm text-gray-500">
              {ongoing && sub ? formatMonthlyPrice(sub.monthly_price) : status.subscribe_price ? formatMonthlyPrice(status.subscribe_price) : ''} · sans engagement
            </p>
          </div>
          {ongoing ? (
            pastDue ? (
              <span className="rounded-full bg-red-50 px-3 py-1 text-xs font-medium text-red-700 ring-1 ring-red-200">Paiement en échec</span>
            ) : cancelling ? (
              <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800 ring-1 ring-amber-200">Résiliation programmée</span>
            ) : (
              <span className="rounded-full bg-green-50 px-3 py-1 text-xs font-medium text-green-700 ring-1 ring-green-200">Actif</span>
            )
          ) : (
            <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600 ring-1 ring-gray-200">
              {sub ? 'Résilié' : 'Non activé'}
            </span>
          )}
        </div>

        {justPaid && !ongoing && (
          <p className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">
            Paiement reçu : votre abonnement s'active dans un instant.
          </p>
        )}

        {ongoing && sub && (
          <div className="grid gap-3 sm:grid-cols-2">
            {endDate && (
              <p className="flex items-center gap-2 text-sm text-gray-600">
                <CalendarClock className="h-4 w-4 text-gray-400" />
                {cancelling
                  ? <>Accès jusqu'au <strong className="text-gray-900">{endDate}</strong>, puis arrêt de l'abonnement.</>
                  : <>Prochain prélèvement le <strong className="text-gray-900">{endDate}</strong>.</>}
              </p>
            )}
            {sub.card && (
              <p className="flex items-center gap-2 text-sm text-gray-600">
                <CreditCard className="h-4 w-4 text-gray-400" />
                {BRAND[sub.card.brand] || sub.card.brand} •••• {sub.card.last4}
                <span className="text-gray-400">· exp. {String(sub.card.exp_month).padStart(2, '0')}/{String(sub.card.exp_year).slice(-2)}</span>
              </p>
            )}
          </div>
        )}

        {pastDue && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4">
            <p className="text-sm text-red-800">
              Le dernier prélèvement a été refusé. Mettez à jour votre carte : une nouvelle tentative est faite automatiquement.
            </p>
            <button
              onClick={() => run('portal')}
              disabled={pending !== null}
              className="mt-3 inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              <CreditCard className="h-4 w-4" /> {pending === 'portal' ? 'Ouverture…' : 'Mettre à jour ma carte'}
            </button>
          </div>
        )}

        {dropsScheduled && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50 p-4">
            <p className="text-sm text-gray-700">
              Passage au <strong>Pass Drops</strong>{dropsPrice ? <> ({formatMonthlyPrice(dropsPrice)})</> : ''} programmé
              {endDate ? <> le <strong>{endDate}</strong></> : ' à la prochaine échéance'}. D'ici là, vous gardez l'accès complet.
            </p>
            <button
              onClick={() => run('cancel_downgrade')}
              disabled={pending !== null}
              className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-gray-800 ring-1 ring-gray-200 hover:bg-gray-100 disabled:opacity-50"
            >
              {pending === 'cancel_downgrade' ? 'Un instant…' : 'Garder mon abonnement actuel'}
            </button>
          </div>
        )}

        {!ongoing && status.subscribe_price && (
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
            <p className="text-sm text-gray-700">
              {status.resubscribe
                ? <>Réactivez votre abonnement au tarif actuel de <strong>{formatMonthlyPrice(status.subscribe_price)}</strong>.</>
                : <>Activez votre abonnement pour <strong>{formatMonthlyPrice(status.subscribe_price)}</strong>, sans engagement.</>}
            </p>
            <button
              onClick={() => run('checkout')}
              disabled={pending !== null}
              className="mt-3 inline-flex items-center gap-2 rounded-xl bg-gray-900 px-5 py-3 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50"
            >
              <CreditCard className="h-4 w-4" />
              {pending === 'checkout' ? 'Ouverture du paiement…' : status.resubscribe ? 'Me réabonner' : 'Activer mon abonnement'}
            </button>
          </div>
        )}

        {error && (
          <p className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" /> {error}
          </p>
        )}

        {sub && (
          <div className="flex flex-wrap items-start gap-3 border-t border-gray-100 pt-4">
            {ongoing && (
              <button
                onClick={() => run('portal')}
                disabled={pending !== null}
                className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-gray-800 ring-1 ring-gray-200 hover:bg-gray-50 disabled:opacity-50"
              >
                <CreditCard className="h-4 w-4" /> {pending === 'portal' ? 'Ouverture…' : 'Changer ma carte'}
              </button>
            )}
            <button
              onClick={toggleInvoices}
              className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-gray-800 ring-1 ring-gray-200 hover:bg-gray-50"
            >
              <FileText className="h-4 w-4" /> {showInvoices ? 'Masquer mes factures' : 'Mes factures'}
            </button>

            {ongoing && !cancelling && !isDrops && !dropsScheduled && dropsPrice && !confirmDrops && (
              <button
                onClick={() => setConfirmDrops(true)}
                className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-gray-800 ring-1 ring-gray-200 hover:bg-gray-50"
              >
                <ArrowDownCircle className="h-4 w-4" /> Passer au Pass Drops
              </button>
            )}

            {confirmDrops && dropsPrice && (
              <div className="w-full space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-4">
                <p className="text-sm text-gray-700">
                  À votre prochaine échéance{endDate ? <> (le <strong>{endDate}</strong>)</> : ''}, votre abonnement passera au{' '}
                  <strong>Pass Drops</strong> à <strong>{formatMonthlyPrice(dropsPrice)}</strong>. Jusque-là, vous gardez l'accès complet ;
                  ensuite, seuls le catalogue et les drops restent inclus (plus d'enchères ni de sourcing sur mesure).
                </p>
                {losesDiscount && status.public_price && (
                  <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                    Votre tarif actuel de <strong>{formatMonthlyPrice(sub!.monthly_price)}</strong> ne pourra plus être retrouvé ensuite.
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => run('downgrade')}
                    disabled={pending !== null}
                    className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
                  >
                    {pending === 'downgrade' ? 'Un instant…' : 'Confirmer le passage au Pass Drops'}
                  </button>
                  <button
                    onClick={() => setConfirmDrops(false)}
                    disabled={pending !== null}
                    className="rounded-lg bg-white px-4 py-2 text-sm text-gray-700 ring-1 ring-gray-200 hover:bg-gray-100"
                  >
                    Annuler
                  </button>
                </div>
              </div>
            )}

            {ongoing && cancelling && (
              <button
                onClick={() => run('resume')}
                disabled={pending !== null}
                className="rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
              >
                {pending === 'resume' ? 'Un instant…' : 'Garder mon abonnement'}
              </button>
            )}

            {ongoing && !cancelling && (
              confirmCancel ? (
                <div className="w-full space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-4">
                  <p className="text-sm text-gray-700">
                    Votre abonnement s'arrêtera à la fin du mois déjà payé{endDate ? <> (le <strong>{endDate}</strong>)</> : ''}. Aucun autre prélèvement ne sera fait.
                  </p>
                  {losesDiscount && status.public_price && (
                    <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                      Vous bénéficiez aujourd'hui d'un tarif réduit de <strong>{formatMonthlyPrice(sub.monthly_price)}</strong>. Si vous résiliez puis
                      vous réabonnez plus tard, vous paierez le prix public des nouveaux membres, actuellement de{' '}
                      <strong>{formatMonthlyPrice(status.public_price)}</strong>.
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => run('cancel')}
                      disabled={pending !== null}
                      className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      {pending === 'cancel' ? 'Un instant…' : 'Confirmer la résiliation'}
                    </button>
                    <button
                      onClick={() => setConfirmCancel(false)}
                      disabled={pending !== null}
                      className="rounded-lg bg-white px-4 py-2 text-sm text-gray-700 ring-1 ring-gray-200 hover:bg-gray-100"
                    >
                      Garder mon abonnement
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmCancel(true)}
                  className="ml-auto px-2 py-2.5 text-sm text-gray-500 underline underline-offset-2 hover:text-gray-800"
                >
                  Résilier mon abonnement
                </button>
              )
            )}
          </div>
        )}

        {showInvoices && (
          <div className="rounded-lg border border-gray-100">
            {invoices === null ? (
              <p className="p-3 text-sm text-gray-500">Chargement…</p>
            ) : invoices.length === 0 ? (
              <p className="p-3 text-sm text-gray-500">Aucune facture pour le moment.</p>
            ) : (
              <ul className="divide-y divide-gray-50">
                {invoices.map((inv) => (
                  <li key={inv.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm">
                    <span className="text-gray-700">
                      {formatDate(inv.created)} {inv.number && <span className="text-gray-400">· {inv.number}</span>}
                    </span>
                    <span className="flex items-center gap-3">
                      <span className="font-medium tabular-nums text-gray-900">{EUR(inv.amount)}</span>
                      {inv.status !== 'paid' && <span className="text-xs text-amber-700">à régler</span>}
                      {inv.invoice_pdf && (
                        <a href={inv.invoice_pdf} target="_blank" rel="noreferrer" className="text-gray-400 hover:text-gray-900" title="Télécharger le PDF">
                          <Download className="h-4 w-4" />
                        </a>
                      )}
                      {inv.hosted_invoice_url && (
                        <a href={inv.hosted_invoice_url} target="_blank" rel="noreferrer" className="text-gray-400 hover:text-gray-900" title="Voir en ligne">
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default CommunityMembershipSection;
