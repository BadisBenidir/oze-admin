import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { supabase } from '../../lib/supabase';
import { ArrowLeft, Mail, Phone, Calendar, MapPin, User, Package, Euro, Edit, Save, X, Loader2 } from 'lucide-react';
import { CustomerWithDetails } from '../../hooks/useCustomers';

interface CustomerProfileProps {
  customerId: string;
  onBack: () => void;
}

/** Champs modifiables depuis l'admin (bouton « Modifier »). L'email n'en fait
 * pas partie : c'est l'identifiant de connexion du client (auth). */
interface EditForm {
  first_name: string;
  last_name: string;
  phone: string;
  birth_date: string;
  address_line1: string;
  address_line2: string;
  postal_code: string;
  city: string;
  country: string;
  newsletter: boolean;
}

interface CustomerProfileData extends CustomerWithDetails {
  first_name: string;
  last_name: string;
  // Données étendues pour le profil
  lastLoginDate?: string;
  registrationDate: string;
  orderHistory: {
    id: string;
    date: string;
    status: string;
    total: number;
  }[];
}

export const CustomerProfile: React.FC<CustomerProfileProps> = ({ customerId, onBack }) => {
  const [customer, setCustomer] = useState<CustomerProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<EditForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const startEdit = () => {
    if (!customer) return;
    setSaveError(null);
    setForm({
      first_name: customer.first_name,
      last_name: customer.last_name,
      phone: customer.phone || '',
      birth_date: customer.birth_date ? customer.birth_date.slice(0, 10) : '',
      address_line1: customer.address_line1 || '',
      address_line2: customer.address_line2 || '',
      postal_code: customer.postal_code || '',
      city: customer.city || '',
      country: customer.country || '',
      newsletter: Boolean(customer.newsletter),
    });
  };

  const save = async () => {
    if (!customer || !form) return;
    setSaving(true);
    setSaveError(null);
    const nul = (v: string) => (v.trim() === '' ? null : v.trim());
    try {
      // .select() : une modification refusée par les droits de la base renvoie
      // 0 ligne sans erreur — on le détecte au lieu d'afficher un faux succès.
      const { data: prof, error: profErr } = await supabase
        .from('profiles')
        .update({ first_name: form.first_name.trim(), last_name: form.last_name.trim() })
        .eq('id', customer.profile_id)
        .select('id');
      if (profErr) throw new Error(profErr.message);
      if (!prof || prof.length === 0) throw new Error('Nom non enregistré : droits insuffisants sur le profil du client.');

      const { data: cust, error: custErr } = await supabase
        .from('customers')
        .update({
          phone: nul(form.phone),
          birth_date: nul(form.birth_date),
          address_line1: nul(form.address_line1),
          address_line2: nul(form.address_line2),
          postal_code: nul(form.postal_code),
          city: nul(form.city),
          country: nul(form.country),
          newsletter: form.newsletter,
        })
        .eq('id', customer.id)
        .select('id');
      if (custErr) throw new Error(custErr.message);
      if (!cust || cust.length === 0) throw new Error('Coordonnées non enregistrées : droits insuffisants sur la fiche client.');

      setCustomer({
        ...customer,
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        name: [form.first_name.trim(), form.last_name.trim()].filter(Boolean).join(' '),
        phone: nul(form.phone),
        birth_date: nul(form.birth_date),
        address_line1: nul(form.address_line1),
        address_line2: nul(form.address_line2),
        postal_code: nul(form.postal_code),
        city: nul(form.city),
        country: nul(form.country),
        newsletter: form.newsletter,
        status: form.address_line1.trim() && form.city.trim() ? 'active' : 'inactive',
      } as CustomerProfileData);
      setForm(null);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    const fetchCustomerProfile = async () => {
      try {
        setLoading(true);
        setError(null);

        // Récupérer les données complètes du client
        const { data, error: fetchError } = await supabase
          .from('customers')
          .select(`
            id,
            profile_id,
            customer_code,
            phone,
            birth_date,
            address_line1,
            address_line2,
            city,
            postal_code,
            country,
            newsletter,
            created_at,
            updated_at,
            profiles!inner (
              id,
              email,
              first_name,
              last_name,
              role,
              created_at,
              updated_at
            )
          `)
          .eq('id', customerId)
          .single();

        if (fetchError) {
          throw new Error(fetchError.message);
        }

        if (!data) {
          throw new Error('Client non trouvé');
        }

        // Transformer les données
        const customerProfile: CustomerProfileData = {
          id: data.id,
          profile_id: data.profile_id,
          customer_code: data.customer_code,
          first_name: data.profiles.first_name || '',
          last_name: data.profiles.last_name || '',
          name: `${data.profiles.first_name} ${data.profiles.last_name}`.trim(),
          email: data.profiles.email,
          phone: data.phone,
          birth_date: data.birth_date,
          address_line1: data.address_line1,
          address_line2: data.address_line2,
          city: data.city,
          postal_code: data.postal_code,
          country: data.country,
          newsletter: data.newsletter,
          totalOrders: 0, // TODO: Calculer depuis les commandes
          totalSpent: 0, // TODO: Calculer depuis les commandes
          status: (data.address_line1 && data.city) ? 'active' : 'inactive',
          joinDate: data.profiles.created_at,
          registrationDate: data.profiles.created_at,
          orderHistory: [] // TODO: Récupérer l'historique des commandes
        };

        setCustomer(customerProfile);
      } catch (err) {
        console.error('Erreur lors du chargement du profil client:', err);
        setError(err instanceof Error ? err.message : 'Erreur inconnue');
      } finally {
        setLoading(false);
      }
    };

    fetchCustomerProfile();
  }, [customerId]);

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded mb-4"></div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <div className="h-64 bg-gray-200 rounded"></div>
            </div>
            <div className="h-64 bg-gray-200 rounded"></div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !customer) {
    return (
      <div className="p-6">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-800 mb-4"
        >
          <ArrowLeft className="h-4 w-4" />
          Retour aux clients
        </button>
        <Card>
          <CardContent className="p-6 text-center">
            <p className="text-red-600">Erreur: {error || 'Client non trouvé'}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* Header avec bouton retour */}
      <div className="flex items-center justify-between mb-6">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-800"
        >
          <ArrowLeft className="h-4 w-4" />
          Retour aux clients
        </button>
        
        <div className="flex items-center gap-3">
          <Badge variant={customer.status === 'active' ? 'success' : 'secondary'}>
            {customer.status === 'active' ? 'Actif' : 'Inactif'}
          </Badge>
          {form ? (
            <>
              <button
                onClick={() => setForm(null)}
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg disabled:opacity-50"
              >
                <X className="h-4 w-4" />
                Annuler
              </button>
              <button
                onClick={save}
                disabled={saving || !form.first_name.trim()}
                className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white hover:bg-gray-800 rounded-lg disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Enregistrer
              </button>
            </>
          ) : (
            <button onClick={startEdit} className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg">
              <Edit className="h-4 w-4" />
              Modifier
            </button>
          )}
        </div>
      </div>

      {/* Titre */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{customer.name}</h1>
        <p className="text-gray-600">Code client: {customer.customer_code}</p>
      </div>

      {form && (
        <Card className="mb-6">
          <CardHeader>
            <h3 className="text-lg font-semibold text-gray-900">Modifier les informations</h3>
          </CardHeader>
          <CardContent>
            {saveError && <p className="mb-4 text-sm text-red-600">{saveError}</p>}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {([
                ['first_name', 'Prénom', 'text'],
                ['last_name', 'Nom', 'text'],
                ['phone', 'Téléphone', 'tel'],
                ['birth_date', 'Date de naissance', 'date'],
                ['address_line1', 'Adresse', 'text'],
                ['address_line2', "Complément d'adresse", 'text'],
                ['postal_code', 'Code postal', 'text'],
                ['city', 'Ville', 'text'],
                ['country', 'Pays', 'text'],
              ] as const).map(([key, label, type]) => (
                <label key={key} className="block">
                  <span className="text-sm text-gray-500">{label}</span>
                  <input
                    type={type}
                    value={form[key]}
                    onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none"
                  />
                </label>
              ))}
              <label className="flex items-center gap-2 self-end pb-2">
                <input type="checkbox" checked={form.newsletter} onChange={(e) => setForm({ ...form, newsletter: e.target.checked })} />
                <span className="text-sm text-gray-700">Abonné à la newsletter</span>
              </label>
            </div>
            <p className="mt-4 text-xs text-gray-400">L'email ({customer.email}) est l'identifiant de connexion du client : il n'est pas modifiable ici.</p>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Informations principales */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <User className="h-5 w-5" />
                Informations personnelles
              </h3>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <Mail className="h-4 w-4 text-gray-400" />
                    <div>
                      <p className="text-sm text-gray-500">Email</p>
                      <p className="font-medium">{customer.email}</p>
                    </div>
                  </div>
                  
                  {customer.phone && (
                    <div className="flex items-center gap-3">
                      <Phone className="h-4 w-4 text-gray-400" />
                      <div>
                        <p className="text-sm text-gray-500">Téléphone</p>
                        <p className="font-medium">{customer.phone}</p>
                      </div>
                    </div>
                  )}
                  
                  {customer.birth_date && (
                    <div className="flex items-center gap-3">
                      <Calendar className="h-4 w-4 text-gray-400" />
                      <div>
                        <p className="text-sm text-gray-500">Date de naissance</p>
                        <p className="font-medium">
                          {new Date(customer.birth_date).toLocaleDateString('fr-FR')}
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                <div className="space-y-4">
                  <div className="flex items-start gap-3">
                    <MapPin className="h-4 w-4 text-gray-400 mt-1" />
                    <div>
                      <p className="text-sm text-gray-500">Adresse</p>
                      <div className="font-medium">
                        {customer.address_line1 && <p>{customer.address_line1}</p>}
                        {customer.address_line2 && <p>{customer.address_line2}</p>}
                        {customer.city && customer.postal_code && (
                          <p>{customer.postal_code} {customer.city}</p>
                        )}
                        <p>{customer.country}</p>
                      </div>
                    </div>
                  </div>
                  
                  <div>
                    <p className="text-sm text-gray-500">Newsletter</p>
                    <p className="font-medium">
                      {customer.newsletter ? 'Abonné' : 'Non abonné'}
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Historique des commandes */}
          <Card className="mt-6">
            <CardHeader>
              <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <Package className="h-5 w-5" />
                Historique des commandes
              </h3>
            </CardHeader>
            <CardContent>
              {customer.orderHistory.length === 0 ? (
                <p className="text-gray-500 text-center py-8">
                  Aucune commande pour le moment
                </p>
              ) : (
                <div className="space-y-3">
                  {customer.orderHistory.map((order) => (
                    <div
                      key={order.id}
                      className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                    >
                      <div>
                        <p className="font-medium">Commande #{order.id}</p>
                        <p className="text-sm text-gray-500">
                          {new Date(order.date).toLocaleDateString('fr-FR')}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-medium">{order.total}€</p>
                        <Badge variant="secondary">{order.status}</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Statistiques */}
        <div>
          <Card>
            <CardHeader>
              <h3 className="text-lg font-semibold text-gray-900">Statistiques</h3>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <Package className="h-8 w-8 text-blue-500" />
                  <div>
                    <p className="text-2xl font-bold">{customer.totalOrders}</p>
                    <p className="text-sm text-gray-500">Commandes</p>
                  </div>
                </div>
                
                <div className="flex items-center gap-3">
                  <Euro className="h-8 w-8 text-green-500" />
                  <div>
                    <p className="text-2xl font-bold">{customer.totalSpent}€</p>
                    <p className="text-sm text-gray-500">Dépenses totales</p>
                  </div>
                </div>
                
                <div className="pt-4 border-t">
                  <p className="text-sm text-gray-500">Client depuis</p>
                  <p className="font-medium">
                    {new Date(customer.registrationDate).toLocaleDateString('fr-FR')}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};