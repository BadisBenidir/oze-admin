import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, Download, Loader2, Package, ShieldCheck, Truck, Home, MapPin, Clock } from 'lucide-react';
import ShippingForm, { ShippingAddress, ShippingFormResult } from './ShippingForm';
import ShippingFormMobile from './ShippingFormMobile';

/**
 * Page publique d'une vente Instagram : pro.ozeparis.com/commande/<jeton>.
 * Sans compte. Tout passe par l'edge function instagram-order (clé service
 * role côté serveur) qui ne renvoie que la commande du jeton.
 * Étapes : récap + certificat Entrupy → livraison (formulaire du site) →
 * virement → facture → suivi du colis.
 */

const TOKEN_RE = /^\/commande\/([A-Za-z0-9_-]{20,64})\/?$/;
export const getInstagramOrderToken = (): string | null => window.location.pathname.match(TOKEN_RE)?.[1] || null;

const FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/instagram-order`;
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

type Stage = 'link_sent' | 'info_submitted' | 'transfer_declared' | 'paid' | 'shipped' | 'delivered' | 'expired' | 'cancelled' | 'payment_conflict';

interface Item {
  product_id: string;
  name: string | null;
  brand: string | null;
  condition: string | null;
  images: string[] | null;
  main_image_index: number | null;
  price: number;
  entrupy: boolean;
}

interface OrderState {
  status: 'ok' | 'invalid';
  stage: Stage;
  order_number: string;
  reference: string;
  expires_at: string;
  items: Item[];
  entrupy_price: number;
  total: number;
  email: string | null;
  shipping_address: Record<string, string> | null;
  info_submitted: boolean;
  transfer_declared_at: string | null;
  paid_at: string | null;
  invoice_number: string | null;
  tracking_number: string | null;
  tracking_url: string | null;
  bank: { beneficiary: string | null; iban: string | null; bic: string | null } | null;
}

const call = async (body: Record<string, unknown>) => {
  const res = await fetch(FN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${ANON}` },
    body: JSON.stringify(body),
  });
  return res;
};

const eur = (n: number) => (Number(n) || 0).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });

const CONDITION_LABEL: Record<string, string> = {
  neuf: 'Neuf',
  excellent: 'Excellent état',
  'very-good': 'Très bon état',
  good: 'Bon état',
  fair: 'État correct',
};
const conditionLabel = (c: string | null) => (!c ? null : CONDITION_LABEL[c] || `Grade ${c}`);

const PAID_STAGES: Stage[] = ['paid', 'shipped', 'delivered'];

const useIsMobile = () => {
  const [mobile, setMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);
  useEffect(() => {
    const onResize = () => setMobile(window.innerWidth < 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return mobile;
};

const CopyField: React.FC<{ label: string; value: string; strong?: boolean }> = ({ label, value, strong }) => {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* presse-papiers indisponible */
    }
  };
  return (
    <div className="flex items-center justify-between gap-3 border-b border-gray-100 py-3 last:border-b-0">
      <div className="min-w-0">
        <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
        <p className={`break-all ${strong ? 'text-base font-semibold text-gray-900' : 'text-sm text-gray-900'}`}>{value}</p>
      </div>
      <button
        type="button"
        onClick={copy}
        className="inline-flex flex-shrink-0 items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-700 active:bg-gray-100"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
        {copied ? 'Copié' : 'Copier'}
      </button>
    </div>
  );
};

const Section: React.FC<{ title: string; step?: number; children: React.ReactNode }> = ({ title, step, children }) => (
  <section className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-6">
    <h2 className="mb-4 flex items-center gap-2 text-base font-semibold text-gray-900">
      {step && <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-900 text-xs text-white">{step}</span>}
      {title}
    </h2>
    {children}
  </section>
);

export const InstagramOrderPage: React.FC = () => {
  const token = getInstagramOrderToken() || '';
  const isMobile = useIsMobile();
  const [state, setState] = useState<OrderState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [entrupy, setEntrupy] = useState<Set<string>>(new Set());
  const [declareMessage, setDeclareMessage] = useState<string | null>(null);
  const entrupyInit = useRef(false);

  const load = useCallback(async () => {
    try {
      const res = await call({ action: 'get', token });
      const data = (await res.json()) as OrderState;
      setState(data);
      if (data.status === 'ok' && !entrupyInit.current) {
        entrupyInit.current = true;
        setEntrupy(new Set(data.items.filter((i) => i.entrupy).map((i) => i.product_id)));
      }
    } catch {
      setError('Impossible de charger la commande. Vérifiez votre connexion.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    document.title = 'Votre commande — OZË Paris';
    load();
  }, [load]);

  // Virement annoncé : on revérifie régulièrement (le rapprochement Qonto
  // tourne chaque minute côté serveur).
  useEffect(() => {
    if (state?.stage !== 'transfer_declared') return;
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, 20000);
    return () => clearInterval(t);
  }, [state?.stage, load]);

  const locked = !state || state.stage !== 'link_sent' && state.stage !== 'info_submitted';
  const itemsTotal = useMemo(() => (state?.items || []).reduce((s, i) => s + Number(i.price), 0), [state]);
  const total = itemsTotal + entrupy.size * (state?.entrupy_price || 25);

  const save = async (email: string, shipping: Record<string, string>, entrupyIds: string[]) => {
    setBusy(true);
    setError(null);
    try {
      const res = await call({ action: 'save', token, email, shipping, entrupy_product_ids: entrupyIds });
      const data = await res.json();
      if (!res.ok || data.error) {
        setError(data.error || 'Enregistrement impossible');
        return false;
      }
      setState(data);
      return true;
    } finally {
      setBusy(false);
    }
  };

  const onFormSubmit = async (r: ShippingFormResult) => {
    const a = r.address;
    const p = r.deliveryType === 'point_relais' ? r.selectedParcelPoint : null;
    const shipping: Record<string, string> = {
      first_name: a.firstName,
      last_name: a.lastName,
      phone: a.phone,
      address: a.address,
      address_line_2: a.addressLine2 || '',
      city: a.city,
      postcode: a.postalCode,
      country: a.country || 'France',
      ...(p
        ? {
            pickup_point_code: p.code || '',
            pickup_point_name: p.name,
            pickup_point_network: p.network,
            pickup_point_address: p.address,
            pickup_point_city: p.city,
            pickup_point_zip: p.zipCode,
          }
        : {}),
    };
    if (await save(a.email, shipping, [...entrupy])) setEditing(false);
  };

  const toggleEntrupy = async (id: string) => {
    if (locked) return;
    const next = new Set(entrupy);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setEntrupy(next);
    // Infos déjà enregistrées : on enregistre tout de suite le nouveau total.
    if (state?.info_submitted && state.email && state.shipping_address) {
      await save(state.email, state.shipping_address, [...next]);
    }
  };

  const declare = async () => {
    setBusy(true);
    setError(null);
    setDeclareMessage(null);
    try {
      const res = await call({ action: 'declare', token });
      const data = await res.json();
      if (!res.ok || data.error) {
        setError(data.error || 'Une erreur est survenue');
        return;
      }
      setState(data);
      if (!PAID_STAGES.includes(data.stage)) {
        setDeclareMessage(
          "Merci ! Votre virement n'est pas encore arrivé sur notre compte. Un virement instantané arrive en quelques minutes ; un virement classique peut prendre 1 à 2 jours ouvrés. Cette page se mettra à jour automatiquement et vous recevrez votre facture par e-mail dès réception."
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const downloadInvoice = async () => {
    setBusy(true);
    try {
      const res = await call({ action: 'invoice', token });
      if (!res.ok) {
        setError('Facture indisponible pour le moment.');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Facture-${state?.invoice_number || state?.order_number}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } finally {
      setBusy(false);
    }
  };

  const header = (
    <header className="border-b border-gray-200 bg-white">
      <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-4">
        <p className="font-serif text-xl tracking-[0.3em] text-gray-900">OZË PARIS</p>
        {state?.status === 'ok' && <p className="text-xs text-gray-500">Commande {state.order_number}</p>}
      </div>
    </header>
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        {header}
        <div className="flex justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      </div>
    );
  }

  if (!state || state.status !== 'ok') {
    return (
      <div className="min-h-screen bg-gray-50">
        {header}
        <div className="mx-auto max-w-md px-4 py-16 text-center">
          <p className="text-lg font-semibold text-gray-900">Lien invalide</p>
          <p className="mt-2 text-sm text-gray-600">{error || "Ce lien de commande n'existe pas. Vérifiez le lien reçu en message ou contactez-nous sur Instagram."}</p>
        </div>
      </div>
    );
  }

  const s = state;
  const paid = PAID_STAGES.includes(s.stage);
  const sa = s.shipping_address || {};
  const isRelay = !!(sa.pickup_point_name || sa.pickup_point_code);
  const initialAddress: ShippingAddress = {
    firstName: sa.first_name || '',
    lastName: sa.last_name || '',
    email: s.email || '',
    phone: sa.phone || '',
    address: sa.address || '',
    addressLine2: sa.address_line_2 || '',
    city: sa.city || '',
    postalCode: sa.postcode || '',
    country: sa.country || 'France',
  };

  if (s.stage === 'expired' || s.stage === 'cancelled' || s.stage === 'payment_conflict') {
    return (
      <div className="min-h-screen bg-gray-50">
        {header}
        <div className="mx-auto max-w-md px-4 py-16 text-center">
          <p className="text-lg font-semibold text-gray-900">
            {s.stage === 'expired' ? 'Ce lien a expiré' : s.stage === 'cancelled' ? 'Commande annulée' : 'Paiement reçu après expiration'}
          </p>
          <p className="mt-2 text-sm text-gray-600">
            {s.stage === 'payment_conflict'
              ? "Votre virement est bien arrivé, mais le lien avait expiré entre-temps. Nous revenons vers vous très vite pour la suite (livraison ou remboursement)."
              : 'Contactez-nous sur Instagram si vous souhaitez toujours commander.'}
          </p>
        </div>
      </div>
    );
  }

  const trackingSteps = [
    { key: 'paid', label: 'En préparation', icon: Package },
    { key: 'shipped', label: 'Expédiée', icon: Truck },
    { key: 'delivered', label: 'Livrée', icon: Home },
  ];
  const trackingIndex = s.stage === 'delivered' ? 2 : s.stage === 'shipped' ? 1 : 0;

  return (
    <div className="min-h-screen bg-gray-50 pb-16">
      {header}
      <main className="mx-auto max-w-2xl space-y-4 px-4 py-5">
        {paid && (
          <div className="rounded-2xl bg-gray-900 p-5 text-white">
            <p className="text-lg font-semibold">Merci, votre paiement est bien reçu ✨</p>
            <p className="mt-1 text-sm text-gray-300">Votre facture vous a été envoyée par e-mail. Suivez ici la préparation et l'expédition de votre colis.</p>
          </div>
        )}

        {paid && (
          <Section title="Suivi de votre commande">
            <ol className="flex items-start justify-between">
              {trackingSteps.map((st, i) => {
                const done = i <= trackingIndex;
                const Icon = st.icon;
                return (
                  <li key={st.key} className="flex flex-1 flex-col items-center text-center">
                    <span className={`flex h-10 w-10 items-center justify-center rounded-full ${done ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-400'}`}>
                      <Icon className="h-5 w-5" />
                    </span>
                    <span className={`mt-2 text-xs ${done ? 'font-semibold text-gray-900' : 'text-gray-400'}`}>{st.label}</span>
                  </li>
                );
              })}
            </ol>
            {s.tracking_number ? (
              <div className="mt-4 rounded-xl bg-gray-50 p-3 text-sm">
                <p className="text-gray-600">
                  N° de suivi : <span className="font-mono font-semibold text-gray-900">{s.tracking_number}</span>
                </p>
                {s.tracking_url && (
                  <a href={s.tracking_url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1.5 font-medium text-gray-900 underline">
                    <Truck className="h-4 w-4" /> Suivre mon colis
                  </a>
                )}
              </div>
            ) : (
              <p className="mt-4 flex items-start gap-2 rounded-xl bg-gray-50 p-3 text-sm text-gray-600">
                <Clock className="mt-0.5 h-4 w-4 flex-shrink-0" />
                Délai de livraison : 1 à 3 semaines. Votre pièce peut encore être au Japon ou en transit vers la France ; le numéro de suivi apparaîtra ici dès l'expédition.
              </p>
            )}
            <button
              type="button"
              onClick={downloadInvoice}
              disabled={busy}
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-gray-300 px-4 py-3 text-sm font-medium text-gray-900 active:bg-gray-100 disabled:opacity-50"
            >
              <Download className="h-4 w-4" /> Télécharger ma facture{s.invoice_number ? ` (${s.invoice_number})` : ''}
            </button>
          </Section>
        )}

        <Section title="Votre sélection" step={paid ? undefined : 1}>
          <ul className="space-y-4">
            {s.items.map((it) => {
              const imgs = it.images || [];
              const img = imgs[it.main_image_index ?? 0] || imgs[0];
              const checked = entrupy.has(it.product_id);
              return (
                <li key={it.product_id} className="border-b border-gray-100 pb-4 last:border-b-0 last:pb-0">
                  <div className="flex gap-3">
                    <div className="h-24 w-24 flex-shrink-0 overflow-hidden rounded-xl bg-gray-100">
                      {img ? <img src={img} alt="" className="h-full w-full object-cover" /> : <Package className="m-8 h-8 w-8 text-gray-300" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      {it.brand && <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{it.brand}</p>}
                      <p className="text-sm font-medium text-gray-900">{it.name}</p>
                      {conditionLabel(it.condition) && <p className="mt-0.5 text-xs text-gray-500">{conditionLabel(it.condition)}</p>}
                      <p className="mt-1 text-base font-semibold text-gray-900">{eur(it.price)}</p>
                    </div>
                  </div>
                  {(!locked || checked) && (
                    <label className={`mt-3 flex items-start gap-3 rounded-xl border p-3 ${checked ? 'border-gray-900 bg-gray-50' : 'border-gray-200'} ${locked ? '' : 'cursor-pointer'}`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={locked || busy}
                        onChange={() => toggleEntrupy(it.product_id)}
                        className="mt-0.5 h-4 w-4 rounded border-gray-300"
                      />
                      <span className="text-sm">
                        <span className="flex items-center gap-1.5 font-medium text-gray-900">
                          <ShieldCheck className="h-4 w-4" /> Certificat d'authenticité Entrupy
                          <span className="ml-auto font-semibold">+{eur(s.entrupy_price)}</span>
                        </span>
                        <span className="text-xs text-gray-500">Authentification indépendante, certificat officiel à votre nom.</span>
                      </span>
                    </label>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="mt-4 space-y-1 border-t border-gray-100 pt-4 text-sm">
            <div className="flex justify-between text-gray-600">
              <span>Articles</span>
              <span>{eur(itemsTotal)}</span>
            </div>
            {entrupy.size > 0 && (
              <div className="flex justify-between text-gray-600">
                <span>Certificat{entrupy.size > 1 ? 's' : ''} Entrupy ({entrupy.size})</span>
                <span>{eur(entrupy.size * s.entrupy_price)}</span>
              </div>
            )}
            <div className="flex justify-between text-gray-600">
              <span>Livraison</span>
              <span>Offerte</span>
            </div>
            <div className="flex justify-between pt-2 text-base font-semibold text-gray-900">
              <span>Total TTC</span>
              <span>{eur(paid || locked ? s.total : total)}</span>
            </div>
            <p className="pt-1 text-xs text-gray-500">Prix incluant le transport Japon → France, les droits de douane et la TVA.</p>
          </div>
        </Section>

        {!paid && (
          <Section title="Livraison" step={2}>
            {s.info_submitted && !editing ? (
              <div className="text-sm text-gray-700">
                <p className="font-medium text-gray-900">
                  {sa.first_name} {sa.last_name}
                </p>
                <p>{s.email} · {sa.phone}</p>
                {isRelay ? (
                  <p className="mt-2 flex items-start gap-1.5">
                    <MapPin className="mt-0.5 h-4 w-4 flex-shrink-0" />
                    <span>
                      Point relais {sa.pickup_point_network ? `(${sa.pickup_point_network})` : ''} : {sa.pickup_point_name}
                      <br />
                      {sa.pickup_point_address}, {sa.pickup_point_zip} {sa.pickup_point_city}
                    </span>
                  </p>
                ) : (
                  <p className="mt-2 flex items-start gap-1.5">
                    <Home className="mt-0.5 h-4 w-4 flex-shrink-0" />
                    <span>
                      {sa.address}
                      {sa.address_line_2 ? `, ${sa.address_line_2}` : ''}
                      <br />
                      {sa.postcode} {sa.city}, {sa.country}
                    </span>
                  </p>
                )}
                {!locked && (
                  <button type="button" onClick={() => setEditing(true)} className="mt-3 text-sm font-medium text-gray-900 underline">
                    Modifier
                  </button>
                )}
              </div>
            ) : isMobile ? (
              <ShippingFormMobile initialData={initialAddress} onSubmit={onFormSubmit} />
            ) : (
              <ShippingForm initialData={initialAddress} onSubmit={onFormSubmit} />
            )}
            {busy && !s.info_submitted && <p className="mt-2 text-sm text-gray-500">Enregistrement…</p>}
          </Section>
        )}

        {!paid && s.info_submitted && !editing && s.bank && (
          <Section title="Paiement par virement" step={3}>
            <div className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
              <p className="font-semibold">Choisissez « virement instantané » pour une validation en quelques minutes.</p>
              <p className="mt-0.5 text-emerald-800">
                Indiquez la référence ci-dessous dans le <strong>motif</strong> du virement (parfois appelé « libellé » ou « message pour le bénéficiaire »).
              </p>
            </div>
            <div>
              {s.bank.beneficiary && <CopyField label="Bénéficiaire" value={s.bank.beneficiary} />}
              {s.bank.iban && <CopyField label="IBAN" value={s.bank.iban} />}
              {s.bank.bic && <CopyField label="BIC" value={s.bank.bic} />}
              <CopyField label="Montant exact" value={(Number(s.total) || 0).toFixed(2).replace('.', ',')} strong />
              <CopyField label="Référence à indiquer dans le motif" value={s.reference} strong />
            </div>
            {s.stage === 'transfer_declared' ? (
              <div className="mt-4 flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
                <Loader2 className="mt-0.5 h-4 w-4 flex-shrink-0 animate-spin" />
                <p>
                  {declareMessage ||
                    "Virement en attente de vérification. Un virement instantané arrive en quelques minutes ; un virement classique peut prendre 1 à 2 jours ouvrés. Cette page se met à jour automatiquement et vous recevrez votre facture par e-mail dès réception."}
                </p>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  onClick={declare}
                  disabled={busy}
                  className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gray-900 px-4 py-3.5 text-sm font-semibold text-white active:bg-gray-800 disabled:opacity-50"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  {busy ? 'Vérification…' : "J'ai fait le virement"}
                </button>
                <p className="mt-2 text-center text-xs text-gray-500">
                  Articles réservés pour vous jusqu'au{' '}
                  {new Date(s.expires_at).toLocaleString('fr-FR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}.
                </p>
              </>
            )}
          </Section>
        )}

        {error && <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}

        <p className="pt-4 text-center text-xs text-gray-400">
          OZË Paris — 6 rue d'Armaillé, 75017 Paris — contact@ozeparis.com
        </p>
      </main>
    </div>
  );
};

export default InstagramOrderPage;
