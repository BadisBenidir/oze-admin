import React, { useState, useEffect } from 'react';
import { Card, CardContent } from '../../ui/Card';
import { useResellerAuth } from '../../../hooks/useResellerAuth';
import { supabase } from '../../../lib/supabase';
import { Building2, CheckCircle2, AlertCircle } from 'lucide-react';

export const ResellerProfile: React.FC = () => {
  const { profile } = useResellerAuth();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (profile) {
      setFirstName(profile.first_name);
      setLastName(profile.last_name);
    }
  }, [profile]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;

    setSaving(true);
    setError(null);
    setSuccess(false);

    const { error: updateError } = await supabase
      .from('profiles')
      .update({ first_name: firstName.trim(), last_name: lastName.trim() })
      .eq('id', profile.id);

    setSaving(false);
    if (updateError) {
      setError(updateError.message);
    } else {
      setSuccess(true);
    }
  };

  if (!profile) return null;

  return (
    <div className="p-4 md:p-6 max-w-lg">
      <h3 className="text-lg font-semibold text-gray-900 mb-6">Mon profil</h3>

      <Card className="mb-6">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm text-gray-700">
            <Building2 className="h-4 w-4 text-gray-400" />
            <span className="font-medium">{profile.company_name}</span>
          </div>
        </CardContent>
      </Card>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-3 flex items-center space-x-2">
          <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {success && (
        <div className="mb-4 bg-green-50 border border-green-200 rounded-lg p-3 flex items-center space-x-2">
          <CheckCircle2 className="h-4 w-4 text-green-600 flex-shrink-0" />
          <p className="text-sm text-green-700">Profil mis à jour</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Prénom</label>
            <input
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nom</label>
            <input
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent"
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
          <input
            type="email"
            value={profile.email}
            disabled
            className="w-full px-3 py-2 border border-gray-200 rounded-lg bg-gray-50 text-gray-500"
          />
        </div>
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50 text-sm"
        >
          {saving ? 'Enregistrement...' : 'Enregistrer'}
        </button>
      </form>
    </div>
  );
};
