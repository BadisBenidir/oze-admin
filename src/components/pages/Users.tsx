import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { DeleteConfirmModal } from '../ui/Modal';
import { supabase } from '../../lib/supabase';
import { useAdminAuth } from '../../hooks/useAdminAuth';
import { Eye, Mail, AlertCircle, Users as UsersIcon, Crown, UserCheck, Search, Trash2 } from 'lucide-react';

// Interface pour un utilisateur (admin ou client)
export interface UserData {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: 'admin' | 'client';
  created_at: string;
  updated_at: string;
  // Données supplémentaires pour les clients
  customer_code?: string;
  phone?: string | null;
  city?: string | null;
  country?: string;
  newsletter?: boolean;
}

interface UseUsersResult {
  users: UserData[];
  loading: boolean;
  error: string | null;
  refreshUsers: () => Promise<void>;
}

const useUsers = (isAuthenticated: boolean = false): UseUsersResult => {
  const [users, setUsers] = useState<UserData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      setError(null);

      // Récupérer tous les profils avec leurs données clients si disponibles
      const { data, error: fetchError } = await supabase
        .from('profiles')
        .select(`
          id,
          email,
          first_name,
          last_name,
          role,
          created_at,
          updated_at,
          customers (
            customer_code,
            phone,
            city,
            country,
            newsletter
          )
        `)
        .order('created_at', { ascending: false });

      if (fetchError) {
        throw new Error(fetchError.message);
      }

      if (!data) {
        setUsers([]);
        return;
      }

      // Transformer les données
      const transformedUsers: UserData[] = data.map(profile => ({
        id: profile.id,
        email: profile.email,
        first_name: profile.first_name,
        last_name: profile.last_name,
        role: profile.role,
        created_at: profile.created_at,
        updated_at: profile.updated_at,
        // Données client si disponibles
        ...(profile.customers?.[0] && {
          customer_code: profile.customers[0].customer_code,
          phone: profile.customers[0].phone,
          city: profile.customers[0].city,
          country: profile.customers[0].country,
          newsletter: profile.customers[0].newsletter,
        })
      }));

      setUsers(transformedUsers);
    } catch (err) {
      console.error('Erreur lors du chargement des utilisateurs:', err);
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  };

  const refreshUsers = async () => {
    await fetchUsers();
  };

  useEffect(() => {
    if (!isAuthenticated) {
      setLoading(false);
      return;
    }
    
    fetchUsers();
  }, [isAuthenticated]);

  return {
    users,
    loading,
    error,
    refreshUsers
  };
};

export const Users: React.FC = () => {
  const { isAdmin } = useAdminAuth();
  const { users, loading, error, refreshUsers } = useUsers(isAdmin);
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | 'admin' | 'client'>('all');
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);
  const [userToDelete, setUserToDelete] = useState<UserData | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  // Filtrage des utilisateurs
  const filteredUsers = users.filter(user => {
    const matchesSearch = 
      user.first_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      user.last_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      user.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (user.customer_code && user.customer_code.toLowerCase().includes(searchTerm.toLowerCase()));
    
    const matchesRole = roleFilter === 'all' || user.role === roleFilter;
    
    return matchesSearch && matchesRole;
  });

  const adminCount = users.filter(u => u.role === 'admin').length;
  const clientCount = users.filter(u => u.role === 'client').length;

  // Fonction pour ouvrir la modal de suppression
  const handleDeleteClick = (user: UserData) => {
    if (user.role === 'admin') {
      alert('Impossible de supprimer un administrateur');
      return;
    }
    
    setUserToDelete(user);
    setShowDeleteModal(true);
  };

  // Fonction pour fermer la modal
  const handleCloseDeleteModal = () => {
    if (deletingUserId) return; // Empêcher la fermeture pendant la suppression
    setShowDeleteModal(false);
    setUserToDelete(null);
  };

  // Fonction pour confirmer la suppression
  const handleConfirmDelete = async () => {
    if (!userToDelete) return;

    try {
      setDeletingUserId(userToDelete.id);

      // Utiliser la fonction RPC pour supprimer complètement l'utilisateur
      const { data, error } = await supabase
        .rpc('delete_user_completely', {
          user_id: userToDelete.id
        });

      if (error) {
        throw new Error(`Erreur RPC: ${error.message}`);
      }

      // Vérifier le résultat de la fonction
      if (!data.success) {
        throw new Error(data.error || 'Erreur inconnue lors de la suppression');
      }

      console.log('Utilisateur supprimé avec succès:', data.deleted_user);

      // Rafraîchir la liste
      await refreshUsers();
      
      // Fermer la modal et nettoyer
      setShowDeleteModal(false);
      setUserToDelete(null);
      
    } catch (error) {
      console.error('Erreur lors de la suppression:', error);
      alert(`Erreur lors de la suppression: ${error instanceof Error ? error.message : 'Erreur inconnue'}`);
    } finally {
      setDeletingUserId(null);
    }
  };

  return (
    <div className="p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 gap-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Utilisateurs</h3>
          <p className="text-sm text-gray-500">
            {loading ? 'Chargement...' : `${filteredUsers.length} utilisateur${filteredUsers.length > 1 ? 's' : ''} trouvé${filteredUsers.length > 1 ? 's' : ''}`}
          </p>
        </div>
        
        {/* Stats */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 px-3 py-1 bg-blue-50 rounded-lg">
            <Crown className="h-4 w-4 text-blue-600" />
            <span className="text-sm font-medium text-blue-700">{adminCount} Admin{adminCount > 1 ? 's' : ''}</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-1 bg-green-50 rounded-lg">
            <UserCheck className="h-4 w-4 text-green-600" />
            <span className="text-sm font-medium text-green-700">{clientCount} Client{clientCount > 1 ? 's' : ''}</span>
          </div>
        </div>
      </div>

      {/* Filtres */}
      <div className="flex flex-col md:flex-row gap-4 mb-6">
        {/* Barre de recherche */}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder="Rechercher par nom, email ou code client..."
            className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:border-gray-400 focus:outline-none"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        
        {/* Filtre par rôle */}
        <select
          className="px-4 py-2 border border-gray-200 rounded-lg focus:border-gray-400 focus:outline-none"
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value as 'all' | 'admin' | 'client')}
        >
          <option value="all">Tous les rôles</option>
          <option value="admin">Administrateurs</option>
          <option value="client">Clients</option>
        </select>
      </div>

      {/* Message d'erreur */}
      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 flex items-center space-x-3">
          <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0" />
          <p className="text-sm text-red-700">Erreur lors du chargement des utilisateurs : {error}</p>
        </div>
      )}

      {/* Message si pas d'utilisateurs */}
      {!loading && !error && filteredUsers.length === 0 && (
        <div className="text-center py-12">
          <UsersIcon className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            {searchTerm || roleFilter !== 'all' ? 'Aucun utilisateur trouvé' : 'Aucun utilisateur'}
          </h3>
          <p className="text-gray-500 mb-6">
            {searchTerm || roleFilter !== 'all' 
              ? 'Essayez de modifier vos critères de recherche'
              : 'Les utilisateurs apparaîtront ici'
            }
          </p>
        </div>
      )}

      {/* Liste des utilisateurs */}
      {(filteredUsers.length > 0 || loading) && (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left py-3 md:py-4 px-4 md:px-6 font-medium text-gray-900 text-xs md:text-sm">Utilisateur</th>
                    <th className="text-left py-3 md:py-4 px-4 md:px-6 font-medium text-gray-900 text-xs md:text-sm hidden sm:table-cell">Rôle</th>
                    <th className="text-left py-3 md:py-4 px-4 md:px-6 font-medium text-gray-900 text-xs md:text-sm hidden lg:table-cell">Inscription</th>
                    <th className="text-left py-3 md:py-4 px-4 md:px-6 font-medium text-gray-900 text-xs md:text-sm">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    // Skeleton loading
                    [...Array(5)].map((_, index) => (
                      <tr key={`skeleton-${index}`} className="border-b border-gray-50">
                        <td className="py-3 md:py-4 px-4 md:px-6">
                          <div className="flex items-center space-x-3">
                            <div className="h-8 w-8 md:h-10 md:w-10 bg-gray-200 rounded-full animate-pulse"></div>
                            <div>
                              <div className="h-4 w-24 bg-gray-200 rounded animate-pulse mb-1"></div>
                              <div className="h-3 w-32 bg-gray-200 rounded animate-pulse"></div>
                            </div>
                          </div>
                        </td>
                        <td className="py-3 md:py-4 px-4 md:px-6 hidden sm:table-cell">
                          <div className="h-6 w-16 bg-gray-200 rounded animate-pulse"></div>
                        </td>
                        <td className="py-3 md:py-4 px-4 md:px-6 hidden lg:table-cell">
                          <div className="h-4 w-20 bg-gray-200 rounded animate-pulse"></div>
                        </td>
                        <td className="py-3 md:py-4 px-4 md:px-6">
                          <div className="h-6 w-6 bg-gray-200 rounded animate-pulse"></div>
                        </td>
                      </tr>
                    ))
                  ) : (
                    filteredUsers.map((user) => (
                      <tr key={user.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                        <td className="py-3 md:py-4 px-4 md:px-6">
                          <div className="flex items-center space-x-3">
                            <div className={`h-8 w-8 md:h-10 md:w-10 rounded-full flex items-center justify-center flex-shrink-0 ${
                              user.role === 'admin' ? 'bg-blue-600' : 'bg-gray-900'
                            }`}>
                              {user.role === 'admin' && <Crown className="h-4 w-4 text-white" />}
                              {user.role === 'client' && (
                                <span className="text-white font-medium text-xs md:text-sm">
                                  {user.first_name[0]}{user.last_name[0]}
                                </span>
                              )}
                            </div>
                            <div>
                              <p className="font-medium text-gray-900 text-sm md:text-base">
                                {user.first_name} {user.last_name}
                              </p>
                              <p className="text-xs md:text-sm text-gray-500">{user.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="py-3 md:py-4 px-4 md:px-6 hidden sm:table-cell">
                          <Badge variant={user.role === 'admin' ? 'primary' : 'success'}>
                            {user.role === 'admin' ? 'Admin' : 'Client'}
                          </Badge>
                        </td>
                        <td className="py-3 md:py-4 px-4 md:px-6 hidden lg:table-cell">
                          <span className="text-xs md:text-sm text-gray-600">
                            {new Date(user.created_at).toLocaleDateString('fr-FR')}
                          </span>
                        </td>
                        <td className="py-3 md:py-4 px-4 md:px-6">
                          <div className="flex items-center space-x-1 md:space-x-2">
                            <button 
                              className="p-1 text-gray-400 hover:text-blue-600 transition-colors"
                              title="Voir les détails"
                            >
                              <Eye className="h-3 w-3 md:h-4 md:w-4" />
                            </button>
                            <button 
                              className="p-1 text-gray-400 hover:text-green-600 transition-colors hidden md:inline-block"
                              title="Envoyer un email"
                              onClick={() => window.open(`mailto:${user.email}`)}
                            >
                              <Mail className="h-3 w-3 md:h-4 md:w-4" />
                            </button>
                            {user.role === 'client' && (
                              <button 
                                className={`p-1 transition-colors hidden md:inline-block ${
                                  deletingUserId === user.id 
                                    ? 'text-gray-300 cursor-not-allowed' 
                                    : 'text-gray-400 hover:text-red-600'
                                }`}
                                title="Supprimer l'utilisateur"
                                onClick={() => handleDeleteClick(user)}
                                disabled={deletingUserId === user.id}
                              >
                                <Trash2 className={`h-3 w-3 md:h-4 md:w-4 ${
                                  deletingUserId === user.id ? 'animate-pulse' : ''
                                }`} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Modal de confirmation de suppression */}
      <DeleteConfirmModal
        isOpen={showDeleteModal}
        onClose={handleCloseDeleteModal}
        onConfirm={handleConfirmDelete}
        userName={userToDelete ? `${userToDelete.first_name} ${userToDelete.last_name}` : ''}
        isDeleting={deletingUserId !== null}
      />
    </div>
  );
};