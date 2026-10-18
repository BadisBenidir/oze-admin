import React from 'react';
import { Card, CardContent } from '../../ui/Card';
import { Badge } from '../../ui/Badge';
import { TeamMember } from '../../../hooks/useResellerTeam';
import { ArrowLeft, Mail, Phone, Calendar, Crown, User } from 'lucide-react';

interface TeamMemberDetailProps {
  member: TeamMember;
  onBack: () => void;
  /** Conservé pour compatibilité : l'historique des commandes n'est plus affiché. */
  onOpenProduct?: (productId: string) => void;
}

/** Fiche d'un membre vue par le contact principal : identité et coordonnées
 * uniquement — jamais ses commandes ni ses montants dépensés. */

export const TeamMemberDetail: React.FC<TeamMemberDetailProps> = ({ member, onBack }) => {

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

    </div>
  );
};
