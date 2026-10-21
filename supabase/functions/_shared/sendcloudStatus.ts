// Classement d'un statut transporteur Sendcloud en étape de livraison B2B
// (shipment_parcels.status), partagé par sendcloud-webhook et
// sendcloud-sync-tracking (avant : deux copies divergentes, qui ne
// reconnaissaient ni « Delivery date changed » ni le colis disponible en point
// relais — le colis restait « En préparation » alors qu'il était arrivé).
//
//   - delivered : livré, retiré par le client, OU disponible en point relais /
//     consigne (le colis est arrivé, il attend son destinataire) ;
//   - shipped   : tout mouvement réel chez le transporteur (pris en charge,
//     trié, en transit, en livraison, date de livraison modifiée, retard,
//     échec de livraison…) ;
//   - null      : non reconnu (étiquette seulement annoncée, erreur…) — le
//     statut actuel est conservé.
// Codes Sendcloud v2 connus : 11 livré, 12 en attente de retrait client,
// 93 retiré par le client, 3/5/7/22/91/92 transit, 4 retard, 8 échec de livraison.

export type ParcelStage = 'label_created' | 'shipped' | 'delivered';

const DELIVERED_IDS = new Set([11, 12, 93]);
const SHIPPED_IDS = new Set([3, 4, 5, 6, 7, 8, 22, 91, 92]);

const DELIVERED_RE =
  /(delivered|livr[ée]|remis au destinataire|collected by (the )?(consignee|recipient|customer)|awaiting (customer )?pick ?up|ready for pick ?up|available for (pick ?up|collection)|at (the )?(service|pick ?up|parcel|relay) ?(point|shop|locker)|in (the )?(parcel )?locker|deposited|vous attend|disponible (en|au|dans)|en attente de retrait|point de retrait|mis à disposition)/;

const SHIPPED_RE =
  /(in transit|en route|transit|collected|picked ?up|sorting|sorted|hub|customs|dispatch(ed)?|forwarded|out for delivery|arrived at|handed over|delivery date changed|delivery (is )?(delayed|rescheduled)|delay|delivery attempt|attempted|driver|on (its|the) way|being delivered|pris en charge|en cours (de|d')|acheminement|\btri\b|triage|trié|en livraison|site de distribution|retard)/;

export function classifySendcloudStatus(statusId: number | string | null | undefined, message: string | null | undefined): ParcelStage | null {
  const id = statusId === null || statusId === undefined || statusId === '' ? null : Number(statusId);
  const m = (message || '').toLowerCase();
  // Annoncé mais pas encore pris en charge par le transporteur : rien ne bouge.
  if (/(not (yet )?collected|non (encore )?(collecté|pris en charge)|ready to send|announced$)/.test(m) && !(id !== null && (DELIVERED_IDS.has(id) || SHIPPED_IDS.has(id)))) return null;
  if ((id !== null && DELIVERED_IDS.has(id)) || DELIVERED_RE.test(m)) return 'delivered';
  if ((id !== null && SHIPPED_IDS.has(id)) || SHIPPED_RE.test(m)) return 'shipped';
  return null;
}
