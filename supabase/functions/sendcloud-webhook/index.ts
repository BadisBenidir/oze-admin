// Edge Function : sendcloud-webhook
//
// Reçoit les événements de suivi Sendcloud (notamment parcel_status_changed)
// pour faire avancer order_items.fulfillment_status / shipment_parcels.status
// de 'label_created' -> 'shipped' -> 'delivered' au fil du transport réel,
// au lieu de rester figés à 'label_created' jusqu'à la prochaine
// synchronisation manuelle (voir sendcloud-sync-tracking).
//
// ⚠️ AVERTISSEMENT — forme du payload non vérifiée en conditions réelles :
// la documentation Sendcloud (sendcloud.dev/api/v3/webhooks/parcel-status-
// changed) confirme le HEADER DE SIGNATURE (voir vérification ci-dessous,
// confirmé) mais PAS le schéma JSON exact du corps — elle indique seulement
// "la donnée reçue est la même que celle renvoyée en consultant un colis
// précis". Le parsing ci-dessous couvre les formes les plus probables
// (`parcel` à la racine ou sous `payload`, `status` en objet {id, message}
// ou `status_code`/`status_description` à plat) et log TOUJOURS le payload
// brut en cas d'échec de parsing — à vérifier dans les logs Supabase
// (Dashboard → Edge Functions → sendcloud-webhook → Logs) dès la première
// vraie notification reçue, et ajuster l'extraction ci-dessous si besoin.
// Le comportement dégrade sans risque : un événement non reconnu est juste
// ignoré (log + 200), jamais un crash ni un mauvais statut appliqué.
//
// Vérification de signature : confirmée par la doc Sendcloud — header
// Sendcloud-Signature, HMAC-SHA256 du corps brut avec la clé secrète du
// compte. Utilise SENDCLOUD_WEBHOOK_SECRET si configuré (copier la
// "Webhook Signature Key" du dashboard Sendcloud, Settings → Webhooks), sinon
// retombe sur SENDCLOUD_SECRET_KEY (même compte, déjà utilisé pour l'API).
//
// À configurer dans le dashboard Sendcloud (Settings → Webhooks) :
//   URL : https://<project-ref>.supabase.co/functions/v1/sendcloud-webhook
//   Événement : Parcel status changed
//
// Déploiement : `supabase functions deploy sendcloud-webhook --no-verify-jwt`
// (--no-verify-jwt nécessaire : Sendcloud n'envoie pas de JWT Supabase, la
// sécurité vient de la vérification de signature ci-dessous)

import { createClient } from 'npm:@supabase/supabase-js@2';

const LOG_PREFIX = '[sendcloud-webhook]';

// Copie identique de sendcloud-sync-tracking/index.ts.
function classifySendcloudStatus(description: string | null | undefined): 'label_created' | 'shipped' | 'delivered' | null {
  const d = (description || '').toLowerCase();
  if (!d) return null;
  if (/(delivered|livr[ée]|remis au destinataire|collected by (the )?(consignee|recipient|customer))/.test(d)) {
    return 'delivered';
  }
  if (/(in transit|en route|transit|collected|picked ?up|sorting|hub|customs|dispatch(ed)?|forwarded|out for delivery|arrived at|handed over)/.test(d)) {
    return 'shipped';
  }
  return null;
}

async function verifySignature(rawBody: string, signatureHeader: string | null, secret: string): Promise<boolean> {
  if (!signatureHeader) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signatureBytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const computedHex = [...new Uint8Array(signatureBytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
  // Comparaison en temps constant : évite de laisser fuiter, via le timing
  // de la réponse, la position du premier caractère différent.
  if (computedHex.length !== signatureHeader.length) return false;
  let diff = 0;
  for (let i = 0; i < computedHex.length; i++) diff |= computedHex.charCodeAt(i) ^ signatureHeader.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req: Request) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const webhookSecret = Deno.env.get('SENDCLOUD_WEBHOOK_SECRET') || Deno.env.get('SENDCLOUD_SECRET_KEY');

  if (!webhookSecret) {
    console.error(`${LOG_PREFIX} Aucun secret configuré (SENDCLOUD_WEBHOOK_SECRET ni SENDCLOUD_SECRET_KEY)`);
    return new Response('Configuration serveur manquante', { status: 500 });
  }

  const rawBody = await req.text();
  const signatureHeader = req.headers.get('Sendcloud-Signature');

  const validSignature = await verifySignature(rawBody, signatureHeader, webhookSecret);
  if (!validSignature) {
    console.error(`${LOG_PREFIX} Signature invalide ou absente`);
    return new Response('Signature invalide', { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody);
  } catch {
    console.error(`${LOG_PREFIX} Corps non-JSON reçu:`, rawBody.slice(0, 500));
    return new Response(JSON.stringify({ received: true }), { status: 200 });
  }

  console.log(`${LOG_PREFIX} Payload reçu:`, JSON.stringify(body).slice(0, 2000));

  try {
    // Formes tolérées : { parcel: {...} }, { payload: { parcel: {...} } },
    // ou le parcel directement à la racine — voir avertissement en tête de
    // fichier.
    const parcel = (body?.parcel as Record<string, unknown>)
      || ((body?.payload as Record<string, unknown>)?.parcel as Record<string, unknown>)
      || body;

    const sendcloudParcelId = parcel?.id != null ? String(parcel.id) : null;
    if (!sendcloudParcelId) {
      console.error(`${LOG_PREFIX} Aucun id de colis trouvé dans le payload — forme inattendue, voir le log ci-dessus`);
      return new Response(JSON.stringify({ received: true }), { status: 200 });
    }

    const statusObj = (parcel?.status as Record<string, unknown>) || null;
    const statusCode = statusObj?.id != null
      ? String(statusObj.id)
      : (parcel?.status_code != null ? String(parcel.status_code) : null);
    const statusMessage = (statusObj?.message as string) || (parcel?.status_description as string) || null;

    const classified = classifySendcloudStatus(statusMessage);

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data, error } = await adminClient.rpc('apply_sendcloud_parcel_status', {
      p_sendcloud_parcel_id: sendcloudParcelId,
      p_new_status: classified,
      p_carrier_status_code: statusCode,
      p_carrier_status_message: statusMessage,
    });

    if (error) {
      console.error(`${LOG_PREFIX} Échec apply_sendcloud_parcel_status pour le colis ${sendcloudParcelId}:`, error.message);
      // 200 quand même : une erreur applicative ne doit pas déclencher de
      // retries en boucle côté Sendcloud pour un événement qu'on ne pourra
      // de toute façon pas mieux traiter au prochain essai identique.
      return new Response(JSON.stringify({ received: true, error: error.message }), { status: 200 });
    }

    if (!data?.found) {
      console.log(`${LOG_PREFIX} Aucun shipment_parcels ne correspond à sendcloud_parcel_id=${sendcloudParcelId} (colis hors périmètre B2B ?)`);
    } else {
      console.log(`${LOG_PREFIX} Colis ${sendcloudParcelId} — statut classifié: ${classified ?? '(non reconnu)'} — shipment ${data.shipment_id} -> ${data.shipment_status}`);
    }

    return new Response(JSON.stringify({ received: true }), { status: 200 });
  } catch (err) {
    console.error(`${LOG_PREFIX} Erreur non gérée:`, err instanceof Error ? err.stack || err.message : err);
    return new Response(JSON.stringify({ received: true }), { status: 200 });
  }
});
