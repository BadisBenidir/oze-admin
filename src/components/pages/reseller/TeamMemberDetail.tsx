import React, { useState } from 'react';
import { Card, CardContent } from '../../ui/Card';
import { Badge } from '../../ui/Badge';
import { TeamMember } from '../../../hooks/useResellerTeam';
import { useMyB2BOrders } from '../../../hooks/useMyB2BOrders';
import { useWallet, WalletTransaction } from '../../../hooks/useWallet';
import { B2BOrdersList } from './B2BOrdersList';
import { ArrowLeft, Mail, Phone, Calendar, Crown, User, Package, Wallet } from 'lucide-react';

const EUR = (n: number) => n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });

const TYPE_LABEL: Record<string, string> = {
  rechargement: 'Recharge',
  achat: 'Achat',
  remboursement: 'Remboursement',
  ajustement_admin: 'Ajustement OZË Paris',
};

const isDebit = (tx: WalletTransaction) => tx.type === 'achat' || (tx.type === 'ajustement_admin' && tx.amount < 0);

interface TeamMemberDetailProps {
  member: TeamMember;
  onBack: () => void;
  onOpenProduct?: (productId: string) => void;
}

/** Fiche d'un membre vue par le contact principal : coordonnées, historique
 * de ses commandes et son portefeuille B2B (solde et mouvements). */
export const TeamMemberDetail: React.FC<TeamMemberDetailProps> = ({ member, onBack, onOpenProduct }) => {
  const [tab, setTab] = useState<'orders' | 'wallet'>('orders');
  const { orders, loading: ordersLoading, error: ordersError } = useMyB2BOrders(true, member.profile_id);
  const { balance, transactions, loading: walletLoading, error: walletError } = useWallet(member.profile_id);
  const tabClass = (t: string) =>
    `flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition-colors ${tab === t ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-700'}`;

  return (
    <div className="p-4 md:p-6 max-w-3xl">
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 mb-6">
        <ArrowLeft className="h-4 w-4" />
        <span>Retour à mon équipe</span>
      </button>

      <Card className="mb-6">
        <CardContent className="p-4">
          <div className="flex items-start gap-4">
            <div className="h-12 w-12 bg-gray-900 rounded-full flex items-center justify-center flex-shrink-0">
              {member.is_primary ? (
                <Crown className="h-5 w-5 text-white" />
              ) : (
                <span className="text-white text-sm font-medium">{member.first_name[0]}{member.last_name[0]}</span>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center flex-wrap gap-2">
                <h3 className="text-lg font-semibold text-gray-900">{member.first_name} {member.last_name}</h3>
                {member.is_primary && <Badge variant="info">Principal</Badge>}
                {member.activated_at ? (
                  <Badge variant="success">Actif</Badge>
                ) : (
                  <Badge variant="warning">En attente d'activation</Badge>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 mt-4">
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <Mail className="h-4 w-4 text-gray-400 flex-shrink-0" />
                  <span>{member.email}</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <Phone className="h-4 w-4 text-gray-400 flex-shrink-0" />
                  <span>{member.phone || 'Non renseigné'}</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <Calendar className="h-4 w-4 text-gray-400 flex-shrink-0" />
                  <span>Ajouté le {new Date(member.created_at).toLocaleDateString('fr-FR')}</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <User className="h-4 w-4 text-gray-400 flex-shrink-0" />
                  <span>{member.is_primary ? 'Contact principal' : 'Sous-compte'}</span>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="mb-4 flex border-b border-gray-200">
        <button onClick={() => setTab('orders')} className={tabClass('orders')}>
          <Package className="h-4 w-4" /> Commandes{!ordersLoading && ` (${orders.length})`}
        </button>
        <button onClick={() => setTab('wallet')} className={tabClass('wallet')}>
          <Wallet className="h-4 w-4" /> Portefeuille
        </button>
      </div>

      {tab === 'orders' && (
        <B2BOrdersList
          orders={orders}
          loading={ordersLoading}
          error={ordersError}
          emptyTitle="Aucune commande"
          emptyMessage={`${member.first_name} n'a pas encore passé de commande.`}
          onOpenProduct={onOpenProduct || (() => {})}
        />
      )}

      {tab === 'wallet' && (
        <div className="space-y-4">
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-gray-500">Solde du portefeuille</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-gray-900">
                {walletLoading ? '…' : walletError ? '—' : EUR(balance)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-0">
              <p className="border-b border-gray-100 px-4 py-3 text-sm font-semibold text-gray-900">Mouvements</p>
              {walletLoading ? (
                <p className="p-4 text-sm text-gray-500">Chargement…</p>
              ) : transactions.length === 0 ? (
                <p className="p-4 text-sm text-gray-500">Aucun mouvement sur ce portefeuille.</p>
              ) : (
                <ul className="divide-y divide-gray-50">
                  {transactions.map((tx) => {
                    const debit = isDebit(tx);
                    const amount = Math.abs(Number(tx.amount) || 0);
                    return (
                      <li key={tx.id} className="flex items-center justify-between gap-3 px-4 py-3">
                        <div className="min-w-0">
                          <p className="text-sm text-gray-900">
                            {TYPE_LABEL[tx.type] || tx.type}
                            {tx.status === 'pending' && <span className="ml-2 text-xs text-amber-600">en attente</span>}
                            {tx.status === 'failed' && <span className="ml-2 text-xs text-red-600">échoué</span>}
                          </p>
                          {tx.note && <p className="truncate text-xs text-gray-500">{tx.note}</p>}
                          <p className="text-xs text-gray-400">{new Date(tx.created_at).toLocaleDateString('fr-FR')}</p>
                        </div>
                        <span className={`text-sm font-medium tabular-nums ${debit ? 'text-gray-900' : 'text-green-600'}`}>
                          {debit ? '−' : '+'}{EUR(amount)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
};
