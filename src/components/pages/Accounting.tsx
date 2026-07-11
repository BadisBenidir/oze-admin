import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { ExpenseModal } from '../ui/ExpenseModal';
import { useAdminAuth } from '../../hooks/useAdminAuth';
import { useAccountingStats } from '../../hooks/useAccountingStats';
import { useExpenses, Expense, EXPENSE_CATEGORY_LABELS } from '../../hooks/useExpenses';
import { useOrders } from '../../hooks/useOrders';
import {
  Plus, Download, Edit, Trash2, TrendingUp, TrendingDown,
  DollarSign, Wallet, PiggyBank, Receipt, FileText, Gavel, Globe, AlertCircle,
} from 'lucide-react';

interface AccountingProps {
  activeSubTab: string;
}

const EUR = (n: number) =>
  (Number(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';

const monthLabel = (ym: string) => {
  const d = new Date(ym + '-01T00:00:00');
  return d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
};

const paymentPaid = (o: any) => ['paid', 'succeeded'].includes(o.payment_status) || ['confirmed', 'shipped', 'delivered'].includes(o.status);

export const Accounting: React.FC<AccountingProps> = ({ activeSubTab }) => {
  const { isAdmin } = useAdminAuth();
  const { stats, loading: statsLoading, error: statsError, refresh: refreshStats } = useAccountingStats(isAdmin);
  const {
    expenses, loading: expensesLoading, total: expensesSum, totalByCategory,
    createExpense, updateExpense, deleteExpense,
  } = useExpenses(isAdmin);
  const { orders, loading: ordersLoading } = useOrders();

  // Modale dépense
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [saving, setSaving] = useState(false);

  const supabaseUrl = (import.meta as any).env?.VITE_SUPABASE_URL || '';

  const handleSaveExpense = async (data: Partial<Expense>) => {
    setSaving(true);
    try {
      if (editing) await updateExpense(editing.id, data);
      else await createExpense(data);
      await refreshStats();
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteExpense = async (id: string, label: string) => {
    if (!confirm(`Supprimer la dépense « ${label} » ?`)) return;
    await deleteExpense(id);
    await refreshStats();
  };

  // ---- KPI Card ----
  const Kpi = ({ label, value, icon: Icon, tone = 'gray', hint }: any) => (
    <Card>
      <CardContent className="p-4 md:p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-600">{label}</p>
            <p className={`text-xl md:text-2xl font-bold ${tone === 'red' ? 'text-red-600' : tone === 'green' ? 'text-green-600' : 'text-gray-900'}`}>
              {value}
            </p>
            {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
          </div>
          <div className={`h-10 w-10 md:h-12 md:w-12 rounded-lg flex items-center justify-center ${
            tone === 'red' ? 'bg-red-50' : tone === 'green' ? 'bg-green-50' : 'bg-gray-50'
          }`}>
            <Icon className={`h-6 w-6 ${tone === 'red' ? 'text-red-600' : tone === 'green' ? 'text-green-600' : 'text-gray-600'}`} />
          </div>
        </div>
      </CardContent>
    </Card>
  );

  const ErrorBox = ({ msg }: { msg: string }) => (
    <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-3">
      <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0" />
      <p className="text-sm text-red-700">{msg}</p>
    </div>
  );

  const Loading = () => <div className="p-6 text-gray-500">Chargement des données…</div>;

  // ========================= VENTES EN LIGNE =========================
  if (activeSubTab === 'ventes-ligne') {
    const sales = orders.filter((o) => o.status !== 'cancelled' && o.status !== 'refunded');
    return (
      <div className="p-4 md:p-6">
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-gray-900">Ventes en ligne</h3>
          <p className="text-sm text-gray-500">Commandes passées sur le site e-commerce</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 md:gap-6 mb-8">
          <Kpi label="CA en ligne" value={EUR(stats?.onlineRevenue || 0)} icon={Globe} tone="green" />
          <Kpi label="Commandes" value={stats?.ordersCount || 0} icon={Receipt} />
          <Kpi label="Panier moyen" value={EUR(stats?.averageBasket || 0)} icon={DollarSign} />
        </div>
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left py-3 px-4 font-medium text-gray-900 text-sm">Date</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-900 text-sm">N° Commande</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-900 text-sm">Client</th>
                    <th className="text-right py-3 px-4 font-medium text-gray-900 text-sm">Montant</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-900 text-sm">Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {ordersLoading ? (
                    <tr><td colSpan={5} className="py-6 text-center text-gray-400 text-sm">Chargement…</td></tr>
                  ) : sales.length === 0 ? (
                    <tr><td colSpan={5} className="py-6 text-center text-gray-400 text-sm">Aucune vente en ligne</td></tr>
                  ) : sales.map((o) => (
                    <tr key={o.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-3 px-4 text-sm text-gray-600">{new Date(o.created_at).toLocaleDateString('fr-FR')}</td>
                      <td className="py-3 px-4 font-mono text-sm text-gray-900">{o.order_number}</td>
                      <td className="py-3 px-4 text-sm text-gray-900">{o.customer_name}</td>
                      <td className="py-3 px-4 text-right font-medium text-gray-900">{EUR(o.total_amount)}</td>
                      <td className="py-3 px-4">
                        <Badge variant={paymentPaid(o) ? 'success' : 'warning'}>
                          {paymentPaid(o) ? 'Encaissée' : 'En attente'}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ========================= DÉPENSES =========================
  if (activeSubTab === 'depenses') {
    return (
      <div className="p-4 md:p-6">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Dépenses</h3>
            <p className="text-sm text-gray-500">{expensesLoading ? 'Chargement…' : `${expenses.length} dépense${expenses.length > 1 ? 's' : ''} • total ${EUR(expensesSum)}`}</p>
          </div>
          <button
            onClick={() => { setEditing(null); setModalOpen(true); }}
            className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors"
          >
            <Plus className="h-4 w-4" /> Nouvelle dépense
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <Kpi label="Total dépenses" value={EUR(expensesSum)} icon={TrendingDown} tone="red" />
          {totalByCategory.slice(0, 3).map((c) => (
            <Kpi key={c.category} label={c.label} value={EUR(c.total)} icon={Wallet} />
          ))}
        </div>

        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left py-3 px-4 font-medium text-gray-900 text-sm">Date</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-900 text-sm">Libellé</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-900 text-sm">Catégorie</th>
                    <th className="text-right py-3 px-4 font-medium text-gray-900 text-sm">Montant</th>
                    <th className="text-right py-3 px-4 font-medium text-gray-900 text-sm">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {expensesLoading ? (
                    <tr><td colSpan={5} className="py-6 text-center text-gray-400 text-sm">Chargement…</td></tr>
                  ) : expenses.length === 0 ? (
                    <tr><td colSpan={5} className="py-6 text-center text-gray-400 text-sm">Aucune dépense enregistrée</td></tr>
                  ) : expenses.map((e) => (
                    <tr key={e.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-3 px-4 text-sm text-gray-600">{new Date(e.spent_at).toLocaleDateString('fr-FR')}</td>
                      <td className="py-3 px-4 text-sm text-gray-900">
                        {e.label}
                        {e.notes && <span className="block text-xs text-gray-400">{e.notes}</span>}
                      </td>
                      <td className="py-3 px-4">
                        <Badge variant="default">{EXPENSE_CATEGORY_LABELS[e.category || 'autre'] || e.category}</Badge>
                      </td>
                      <td className="py-3 px-4 text-right font-medium text-red-600">−{EUR(e.amount)}</td>
                      <td className="py-3 px-4">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => { setEditing(e); setModalOpen(true); }} className="p-2 text-gray-400 hover:text-green-600" title="Modifier">
                            <Edit className="h-4 w-4" />
                          </button>
                          <button onClick={() => handleDeleteExpense(e.id, e.label)} className="p-2 text-gray-400 hover:text-red-600" title="Supprimer">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <ExpenseModal
          isOpen={modalOpen}
          onClose={() => setModalOpen(false)}
          onSave={handleSaveExpense}
          expense={editing}
          isLoading={saving}
        />
      </div>
    );
  }

  // ========================= FACTURES =========================
  if (activeSubTab === 'factures') {
    const invoiced = orders.filter((o: any) => o.invoice_number);
    return (
      <div className="p-4 md:p-6">
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-gray-900">Factures</h3>
          <p className="text-sm text-gray-500">Factures émises (numéro attribué au paiement de la commande)</p>
        </div>
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left py-3 px-4 font-medium text-gray-900 text-sm">N° Facture</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-900 text-sm">Client</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-900 text-sm">Date</th>
                    <th className="text-right py-3 px-4 font-medium text-gray-900 text-sm">Montant</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-900 text-sm">Paiement</th>
                    <th className="text-right py-3 px-4 font-medium text-gray-900 text-sm">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {ordersLoading ? (
                    <tr><td colSpan={6} className="py-6 text-center text-gray-400 text-sm">Chargement…</td></tr>
                  ) : invoiced.length === 0 ? (
                    <tr><td colSpan={6} className="py-6 text-center text-gray-400 text-sm">Aucune facture émise</td></tr>
                  ) : invoiced.map((o: any) => (
                    <tr key={o.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-3 px-4 font-mono text-sm font-medium text-gray-900">{o.invoice_number}</td>
                      <td className="py-3 px-4 text-sm text-gray-900">{o.customer_name}</td>
                      <td className="py-3 px-4 text-sm text-gray-600">{new Date(o.created_at).toLocaleDateString('fr-FR')}</td>
                      <td className="py-3 px-4 text-right font-medium text-gray-900">{EUR(o.total_amount)}</td>
                      <td className="py-3 px-4">
                        <Badge variant={paymentPaid(o) ? 'success' : 'warning'}>{paymentPaid(o) ? 'Payée' : 'Impayée'}</Badge>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center justify-end">
                          <a
                            href={`${supabaseUrl}/functions/v1/order-invoice?order_id=${o.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 px-3 py-1.5 text-sm text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50"
                            title="Télécharger la facture PDF"
                          >
                            <Download className="h-4 w-4" /> PDF
                          </a>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ========================= PAIEMENTS =========================
  if (activeSubTab === 'paiements') {
    if (statsLoading) return <Loading />;
    const recent = [...orders]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 8);
    return (
      <div className="p-4 md:p-6">
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-gray-900">Paiements</h3>
          <p className="text-sm text-gray-500">Encaissements et remboursements</p>
        </div>
        {statsError && <ErrorBox msg={statsError} />}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 md:gap-6 mb-8">
          <Kpi label="Encaissé (CA en ligne)" value={EUR(stats?.onlineRevenue || 0)} icon={TrendingUp} tone="green" />
          <Kpi label="En attente" value={EUR(stats?.pendingTotal || 0)} icon={Wallet} />
          <Kpi label="Remboursements" value={EUR(stats?.refundedTotal || 0)} icon={TrendingDown} tone="red" />
        </div>
        <Card>
          <CardHeader><h3 className="text-lg font-semibold text-gray-900">Transactions récentes</h3></CardHeader>
          <CardContent>
            <div className="space-y-3">
              {recent.length === 0 && <p className="text-sm text-gray-500 text-center">Aucune transaction</p>}
              {recent.map((o) => {
                const refunded = o.payment_status === 'refunded' || o.status === 'refunded';
                return (
                  <div key={o.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <div className="flex items-center gap-3">
                      <div className={`h-9 w-9 rounded-full flex items-center justify-center ${refunded ? 'bg-red-100' : 'bg-green-100'}`}>
                        {refunded ? <TrendingDown className="h-4 w-4 text-red-600" /> : <TrendingUp className="h-4 w-4 text-green-600" />}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-900">{o.order_number} — {o.customer_name}</p>
                        <p className="text-xs text-gray-500">{new Date(o.created_at).toLocaleDateString('fr-FR')}</p>
                      </div>
                    </div>
                    <span className={`font-medium ${refunded ? 'text-red-600' : 'text-green-600'}`}>
                      {refunded ? '−' : '+'}{EUR(o.total_amount)}
                    </span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ========================= RAPPORTS FINANCIERS =========================
  if (activeSubTab === 'rapports-financiers') {
    if (statsLoading) return <Loading />;
    const monthly = stats?.monthly || [];
    return (
      <div className="p-4 md:p-6">
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-gray-900">Rapports financiers</h3>
          <p className="text-sm text-gray-500">Évolution mensuelle : chiffre d'affaires, dépenses et résultat</p>
        </div>
        {statsError && <ErrorBox msg={statsError} />}
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left py-3 px-4 font-medium text-gray-900 text-sm">Mois</th>
                    <th className="text-right py-3 px-4 font-medium text-gray-900 text-sm">Chiffre d'affaires</th>
                    <th className="text-right py-3 px-4 font-medium text-gray-900 text-sm">Dépenses</th>
                    <th className="text-right py-3 px-4 font-medium text-gray-900 text-sm">Résultat (hors COGS)</th>
                  </tr>
                </thead>
                <tbody>
                  {monthly.length === 0 ? (
                    <tr><td colSpan={4} className="py-6 text-center text-gray-400 text-sm">Pas encore de données</td></tr>
                  ) : monthly.map((m) => (
                    <tr key={m.ym} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-3 px-4 text-sm text-gray-900 capitalize">{monthLabel(m.ym)}</td>
                      <td className="py-3 px-4 text-right text-sm text-gray-900">{EUR(m.revenue)}</td>
                      <td className="py-3 px-4 text-right text-sm text-red-600">−{EUR(m.expenses)}</td>
                      <td className={`py-3 px-4 text-right text-sm font-medium ${m.result >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {m.result >= 0 ? '+' : ''}{EUR(m.result)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
        <p className="mt-3 text-xs text-gray-400">
          Le résultat mensuel = CA − dépenses du mois. Le coût d'achat des marchandises (COGS) est pris en compte dans le « Bénéfice net » global du tableau de bord.
        </p>
      </div>
    );
  }

  // ========================= DASHBOARD (défaut) =========================
  if (statsLoading) return <Loading />;
  return (
    <div className="p-4 md:p-6">
      {statsError && <ErrorBox msg={statsError} />}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 md:gap-6 mb-6 md:mb-8">
        <Kpi label="Chiffre d'affaires" value={EUR(stats?.ca || 0)} icon={DollarSign} tone="green" hint="Ventes en ligne + Live enchères" />
        <Kpi label="Dépenses" value={EUR(stats?.expensesTotal || 0)} icon={TrendingDown} tone="red" />
        <Kpi label="Marge brute" value={EUR(stats?.grossMargin || 0)} icon={PiggyBank} hint="CA − coût d'achat des articles vendus" />
        <Kpi label="Bénéfice net" value={EUR(stats?.netProfit || 0)} icon={Wallet} tone={(stats?.netProfit || 0) >= 0 ? 'green' : 'red'} hint="Marge brute − dépenses" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
        <Card>
          <CardHeader><h3 className="text-lg font-semibold text-gray-900">Sources de revenus</h3></CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm text-gray-600"><Globe className="h-4 w-4 text-blue-500" /> Ventes en ligne</span>
                <span className="text-sm font-medium text-gray-900">{EUR(stats?.onlineRevenue || 0)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm text-gray-600"><Gavel className="h-4 w-4 text-indigo-500" /> Ventes Live enchères</span>
                <span className="text-sm font-medium text-gray-900">{EUR(stats?.auctionRevenue || 0)}</span>
              </div>
              <div className="pt-2 border-t border-gray-200 flex items-center justify-between">
                <span className="text-sm font-medium text-gray-900">Total CA</span>
                <span className="text-sm font-bold text-gray-900">{EUR(stats?.ca || 0)}</span>
              </div>
              <div className="flex items-center justify-between text-xs text-gray-400">
                <span>Coût d'achat des articles vendus (COGS)</span>
                <span>−{EUR(stats?.cogs || 0)}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><h3 className="text-lg font-semibold text-gray-900">Répartition des dépenses</h3></CardHeader>
          <CardContent>
            {totalByCategory.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-4">Aucune dépense enregistrée. Onglet « Dépenses » pour en ajouter.</p>
            ) : (
              <div className="space-y-4">
                {totalByCategory.map((c) => {
                  const pct = expensesSum > 0 ? Math.round((c.total / expensesSum) * 100) : 0;
                  return (
                    <div key={c.category}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm text-gray-600">{c.label}</span>
                        <span className="text-sm font-medium text-gray-900">{EUR(c.total)} ({pct}%)</span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div className="bg-red-500 h-2 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <p className="mt-4 text-xs text-gray-400">
        Chiffres en temps réel. Approximation de gestion : le CA en ligne inclut les frais de port ; le COGS agrège les prix d'achat des articles vendus (en ligne, Live enchères, autres plateformes, affichés).
      </p>
    </div>
  );
};