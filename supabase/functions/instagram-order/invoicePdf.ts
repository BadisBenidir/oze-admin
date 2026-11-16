// Rendu PDF de facture web — copie de oze-storefront/supabase/functions/order-invoice
// (buildInvoicePdf), utilisée pour les ventes Instagram.
// @ts-nocheck — runtime Deno Supabase.
import { PDFDocument, StandardFonts, rgb, degrees } from 'https://esm.sh/pdf-lib@1.17.1'

const EUR = (n: any) => (Number(n) || 0).toFixed(2).replace('.', ',') + ' EUR'

// TVA (admin, migrations 0280 / 0281) : franchise en base (art. 293 B)
// jusqu'à vat_settings.vat_start_at, TVA ensuite. Prix inchangés, désormais
// TTC : HT = TTC / (1 + taux), TVA = TTC − HT. Taux lu d'après la date de la
// commande (opération).
const splitTtc = (ttc: any, rate: number) => {
  const t = Number(ttc) || 0
  if (!rate) return { ht: t, vat: 0 }
  const ht = Math.round((t / (1 + rate / 100)) * 100) / 100
  return { ht, vat: Math.round((t - ht) * 100) / 100 }
}

// Mention de paiement : moyen RÉEL de la commande (orders.payment_method_effective,
// migration admin 0287) — inconnu → « Facture acquittée » sans préciser.
const PAYMENT_LABELS: Record<string, string> = {
  card: 'carte bancaire (Stripe)',
  paypal: 'PayPal',
  transfer: 'virement bancaire',
  wallet: 'solde du portefeuille revendeur',
  mixed: 'solde du portefeuille revendeur et carte bancaire (Stripe)',
  cash: 'espèces',
}

// Génère le PDF de la facture et renvoie les octets.
export async function buildInvoicePdf(order: any, items: any[], vat: { rate: number; number?: string | null } = { rate: 0 }): Promise<Uint8Array> {
  const vatRate = Number(vat?.rate) || 0
  const vatNumber = vat?.number || 'FR10105405211'
  const pdf = await PDFDocument.create()
  const page = pdf.addPage([595.28, 841.89]) // A4
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const { width, height } = page.getSize()
  const M = 50
  const dark = rgb(0.1, 0.1, 0.1)
  const grey = rgb(0.45, 0.45, 0.45)
  const red = rgb(0.78, 0.12, 0.12)

  // Commande annulée → mention + filigrane.
  const cancelled = order.status === 'cancelled'
  const refunded = order.payment_status === 'refunded'
  const cancelLabel = refunded ? 'REMBOURSÉE' : 'ANNULÉE'

  const text = (s: string, x: number, y: number, size = 10, f = font, color = dark) =>
    page.drawText(String(s ?? ''), { x, y, size, font: f, color })
  const right = (s: string, rx: number, y: number, size = 10, f = font, color = dark) => {
    const w = f.widthOfTextAtSize(String(s ?? ''), size)
    page.drawText(String(s ?? ''), { x: rx - w, y, size, font: f, color })
  }
  const center = (s: string, cx: number, y: number, size = 10, f = font, color = dark) => {
    const w = f.widthOfTextAtSize(String(s ?? ''), size)
    page.drawText(String(s ?? ''), { x: cx - w / 2, y, size, font: f, color })
  }
  // Découpe une chaîne en lignes qui tiennent dans maxW (évite tout texte coupé).
  const wrap = (s: string, maxW: number, size = 10, f = font): string[] => {
    const words = String(s ?? '').split(/\s+/).filter(Boolean)
    const lines: string[] = []
    let cur = ''
    for (const w of words) {
      const test = cur ? cur + ' ' + w : w
      if (f.widthOfTextAtSize(test, size) > maxW && cur) { lines.push(cur); cur = w }
      else cur = test
    }
    if (cur) lines.push(cur)
    return lines.length ? lines : ['']
  }

  let y = height - M

  // Logo
  try {
    const logoRes = await fetch('https://ozeparis.com/logov4.PNG')
    if (logoRes.ok) {
      const logo = await pdf.embedPng(new Uint8Array(await logoRes.arrayBuffer()))
      const lw = 110
      const lh = (logo.height / logo.width) * lw
      page.drawImage(logo, { x: M, y: y - lh, width: lw, height: lh })
    }
  } catch (_) { /* logo optionnel */ }

  // Titre + méta (à droite), descendus pour centrer le bloc verticalement sur le logo.
  // Facture rectificative (admin, 0287) : elle remplace l'originale à l'affichage.
  const rect = order.rectification
  right(rect ? 'FACTURE RECTIFICATIVE' : 'FACTURE', width - M, y - 30, rect ? 16 : 22, bold)
  right(`N° ${order.invoice_number || order.order_number}`, width - M, y - 48, 10, bold)
  right(`Commande : ${order.order_number}`, width - M, y - 62, 9, font, grey)
  const fmtDate = (d: any) => new Date(d || Date.now()).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })
  const dateStr = fmtDate(rect ? rect.issued_at : order.created_at)
  right(`Date : ${dateStr}`, width - M, y - 74, 9, font, grey)
  if (rect) right(`Rectifie : ${rect.number} du ${fmtDate(rect.date)}`, width - M, y - 86, 9, font, grey)
  if (cancelled) right(cancelLabel, width - M, y - 90, 13, bold, red)

  // Un peu d'air entre l'en-tête (logo + FACTURE) et le reste de la facture.
  y -= 150

  // Vendeur (gauche) / Client (droite) — sans le capital (reporté en pied de page).
  const seller = ['SASU OZË PARIS', '6 Rue d\'Armaillé', '75017 Paris', 'France', 'SIRET : 10540521100019', `TVA : ${vatNumber}`, 'contact@ozeparis.com']
  const sa = order.shipping_address || {}
  const buyerName = sa.name || `${sa.first_name || ''} ${sa.last_name || ''}`.trim() || order.email
  const isRelay = Boolean(sa.pickup_point_code)
  const buyer = (isRelay
    ? [buyerName, `Point Relais : ${sa.pickup_point_name || ''}`, sa.pickup_point_address || '', `${sa.pickup_point_zip || ''} ${sa.pickup_point_city || ''}`, order.email]
    : [buyerName, sa.address || '', `${sa.postcode || ''} ${sa.city || ''}`, sa.country || 'France', order.email]
  ).filter(Boolean).map(String)

  text('ÉMETTEUR', M, y, 9, bold, grey)
  text('FACTURÉ À', width / 2 + 10, y, 9, bold, grey)
  y -= 14
  const blockTop = y
  const sellerW = (width / 2 - 10) - M
  const buyerW = (width - M) - (width / 2 + 10)
  // On passe les lignes trop longues à la ligne (rien n'est coupé).
  const sellerItems = seller.flatMap((l, i) => wrap(l, sellerW, 10, i === 0 ? bold : font).map((t) => ({ t, b: i === 0 })))
  const buyerItems = buyer.flatMap((l, i) => wrap(l, buyerW, 10, i === 0 ? bold : font).map((t) => ({ t, b: i === 0 })))
  sellerItems.forEach((it, i) => text(it.t, M, blockTop - i * 12, 10, it.b ? bold : font))
  buyerItems.forEach((it, i) => text(it.t, width / 2 + 10, blockTop - i * 12, 10, it.b ? bold : font))

  y = blockTop - Math.max(sellerItems.length, buyerItems.length) * 12 - 24

  // En-tête tableau
  const colDesc = M
  const colQty = width - M - 200
  const colPU = width - M - 110
  const colTot = width - M
  page.drawRectangle({ x: M, y: y - 4, width: width - 2 * M, height: 20, color: rgb(0.96, 0.96, 0.96) })
  text('Article', colDesc + 4, y + 2, 9, bold, grey)
  right('Qté', colQty + 20, y + 2, 9, bold, grey)
  right(vatRate ? 'P.U. HT' : 'P.U.', colPU + 30, y + 2, 9, bold, grey)
  right(vatRate ? 'Total HT' : 'Total', colTot - 4, y + 2, 9, bold, grey)
  y -= 22

  // Lignes
  for (const it of items || []) {
    const snap = it.product_snapshot || {}
    let label = `${snap.brand_name ? snap.brand_name + ' — ' : ''}${snap.name || 'Article'}`
    if (label.length > 58) label = label.slice(0, 57) + '…'
    text(label, colDesc + 4, y, 10)
    right(String(it.quantity ?? 1), colQty + 20, y, 10)
    right(EUR(splitTtc(it.unit_price, vatRate).ht), colPU + 30, y, 10)
    right(EUR(splitTtc(it.line_total, vatRate).ht), colTot - 4, y, 10)
    y -= 18
    page.drawLine({ start: { x: M, y: y + 6 }, end: { x: width - M, y: y + 6 }, thickness: 0.5, color: rgb(0.9, 0.9, 0.9) })
  }

  // Totaux
  y -= 12
  const totX = width - M
  const labX = width - M - 200
  const totals = splitTtc(order.total_amount, vatRate)
  text(vatRate ? 'Sous-total HT' : 'Sous-total', labX, y, 10, font, grey); right(EUR(splitTtc(order.subtotal, vatRate).ht), totX, y, 10); y -= 16
  text(vatRate ? 'Livraison HT' : 'Livraison', labX, y, 10, font, grey); right(EUR(splitTtc(order.shipping_cost, vatRate).ht), totX, y, 10); y -= 16
  if (vatRate) {
    text('Total HT', labX, y, 10, font, grey); right(EUR(totals.ht), totX, y, 10); y -= 16
    text(`TVA ${String(vatRate).replace('.', ',')} %`, labX, y, 10, font, grey); right(EUR(totals.vat), totX, y, 10); y -= 16
  }
  y -= 2
  page.drawLine({ start: { x: labX, y: y + 8 }, end: { x: totX, y: y + 8 }, thickness: 0.7, color: rgb(0.8, 0.8, 0.8) })
  text(vatRate ? 'TOTAL TTC' : 'TOTAL', labX, y - 4, 12, bold); right(EUR(order.total_amount), totX, y - 4, 12, bold); y -= 30

  if (cancelled) {
    text(refunded
      ? 'Commande annulée — montant remboursé sur le moyen de paiement d\'origine.'
      : 'Commande annulée.', M, y, 9, bold, red)
  } else {
    const pm = PAYMENT_LABELS[order.payment_method_effective || '']
    text(pm ? `Facture acquittée — paiement par ${pm}.` : 'Facture acquittée.', M, y, 9, font, grey)
    if (rect) {
      const lines = wrap(`Facture rectificative de la facture n° ${rect.number} du ${fmtDate(rect.date)} — ${rect.reason || ''}`, width - 2 * M, 9)
      lines.forEach((l, i) => text(l, M, y - 14 - i * 11, 9, font, grey))
    }
  }

  // Pied de page centré, tout en bas.
  center(`SASU OZË PARIS au capital de 1 000 € — SIRET 10540521100019 — RCS Paris 105 405 211 — TVA ${vatNumber}`, width / 2, M + 22, 7.5, font, grey)
  center('6 Rue d\'Armaillé, 75017 Paris, France — contact@ozeparis.com', width / 2, M + 11, 7.5, font, grey)
  if (!vatRate) center('TVA non applicable, art. 293 B du CGI', width / 2, M, 7.5, font, grey)

  // Filigrane diagonal « ANNULÉE / REMBOURSÉE » en travers de la facture.
  if (cancelled) {
    page.drawText(cancelLabel, {
      x: 95, y: 260, size: 88, font: bold, color: red,
      rotate: degrees(38), opacity: 0.12,
    })
  }

  return await pdf.save()
}
