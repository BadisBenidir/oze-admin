import React from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Printer, Download } from 'lucide-react';

// Taille de police du modèle : rétrécit automatiquement si le nom est long,
// pour tenir sur l'étiquette sans être tronqué. (mm pour l'écran, pt pour le PDF.)
const modelFontMm = (name: string): number => {
  const n = name.trim().length;
  if (n <= 44) return 2.1;
  if (n <= 60) return 1.8;
  if (n <= 80) return 1.55;
  return 1.35;
};
const modelFontPt = (name: string): number => {
  const n = name.trim().length;
  if (n <= 44) return 6.5;
  if (n <= 60) return 5.6;
  if (n <= 80) return 4.8;
  return 4.2;
};

interface ProductLabelProps {
  /** Nom / modèle de l'article. */
  name: string;
  /** Référence « OZ-[MARQUE]-[NNN] », encodée dans le QR Code. */
  reference: string;
  /** Nom de la marque (optionnel, affiché en surtitre). */
  brandName?: string;
}

/**
 * Étiquette produit (style luxe), format 30 × 40 mm.
 *
 * Ordre : marque → modèle → référence → petit QR Code (en bas).
 * Typographie unifiée (même police partout). Aperçu écran légèrement agrandi ;
 * impression / PDF à la taille réelle 30 × 40 mm.
 */
export const ProductLabel: React.FC<ProductLabelProps> = ({ name, reference, brandName }) => {
  const downloadPdf = async () => {
    const [{ jsPDF }, qrMod] = await Promise.all([
      import('jspdf'),
      import('qrcode'),
    ]);
    const QRCode = (qrMod as unknown as { default?: typeof qrMod }).default ?? qrMod;

    const W = 30;
    const H = 40;
    const doc = new jsPDF({ unit: 'mm', format: [W, H], orientation: 'portrait' });
    doc.setTextColor(20);

    // Texte centré avec espacement de lettres (jsPDF ne centre pas correctement
    // avec 'align: center' quand charSpace est utilisé → on calcule x à la main).
    const centeredSpaced = (text: string, yy: number, cs: number) => {
      const tw = doc.getTextWidth(text) + cs * Math.max(text.length - 1, 0);
      doc.text(text, (W - tw) / 2, yy, { charSpace: cs });
    };

    let y = 5;

    // Marque : Helvetica MAJUSCULES, lettres espacées.
    if (brandName) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.8);
      centeredSpaced(brandName.toUpperCase(), y, 0.7);
      y += 3.2;
    }

    // Modèle : Helvetica minuscules, taille adaptative (rétrécit si long).
    // Sans charSpace (sinon la largeur réelle dépasse le calcul de retour à la ligne
    // → lettres coupées au bord). Largeur de wrap 25 mm pour garder une marge.
    const mPt = modelFontPt(name);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(mPt);
    const mGap = mPt * 0.42; // interligne proportionnel (mm)
    const modelLines = (doc.splitTextToSize(name.toLowerCase(), 25) as string[]).slice(0, 3);
    for (const line of modelLines) {
      doc.text(line, W / 2, y, { align: 'center' });
      y += mGap;
    }

    // Référence : Courier (machine à écrire).
    doc.setFont('courier', 'normal');
    doc.setFontSize(8);
    doc.text(reference, W / 2, y + 2, { align: 'center' });

    // Petit QR Code en bas, centré.
    const qrDataUrl = await QRCode.toDataURL(reference, { margin: 0, width: 200 });
    const qrSize = 12;
    doc.addImage(qrDataUrl, 'PNG', (W - qrSize) / 2, H - qrSize - 2.5, qrSize, qrSize);

    doc.save(`${reference}.pdf`);
  };

  return (
    <div className="flex flex-col items-center gap-5">
      <style>{`
        /* Aperçu légèrement agrandi à l'écran (l'étiquette réelle reste 30x40 mm). */
        .oze-label-preview { zoom: 1.7; }
        @media print {
          .oze-label-preview { zoom: 1; }
          body * { visibility: hidden !important; }
          #oze-print-label, #oze-print-label * { visibility: visible !important; }
          #oze-print-label { position: fixed; inset: 0; margin: auto; }
          .no-print { display: none !important; }
          @page { margin: 8mm; }
        }
      `}</style>

      <div className="oze-label-preview">
        <div
          id="oze-print-label"
          className="bg-white text-black flex flex-col items-center justify-between text-center overflow-hidden"
          style={{ width: '30mm', height: '40mm', padding: '2mm', fontFamily: 'Helvetica, Arial, sans-serif' }}
        >
          {/* Marque (Helvetica MAJ espacé) + modèle (minuscule espacé) + réf (Courier) */}
          <div className="w-full text-center">
            {brandName && (
              <p className="uppercase text-neutral-900 leading-tight break-words" style={{ fontSize: '2.3mm' }}>
                {/* inline-block + marge négative = espacement large MAIS centrage correct (Safari ok).
                    max-width + white-space normal : une marque longue revient à la ligne sans déborder. */}
                <span
                  style={{
                    fontWeight: 500,
                    letterSpacing: '0.3em',
                    marginRight: '-0.3em',
                    display: 'inline-block',
                    maxWidth: '100%',
                    whiteSpace: 'normal',
                    wordBreak: 'break-word',
                  }}
                >
                  {brandName}
                </span>
              </p>
            )}
            {/* Modèle : retour à la ligne normal (coupe aux espaces) + rétrécit si long.
                Pas de letter-spacing ici : il décalait/rognait les lettres en bord de ligne. */}
            <p
              className="lowercase text-neutral-600 leading-tight mt-[1mm]"
              style={{ fontSize: `${modelFontMm(name)}mm`, overflowWrap: 'break-word' }}
            >
              {name}
            </p>
            <p
              className="mt-[2.2mm] text-neutral-900 break-all"
              style={{ fontFamily: "'Courier New', Courier, monospace", fontSize: '2.3mm', letterSpacing: '0.04em' }}
            >
              {reference}
            </p>
          </div>

          {/* Petit QR Code en bas */}
          <QRCodeSVG value={reference} size={80} level="M" marginSize={0} className="mx-auto h-[12mm] w-[12mm]" />
        </div>
      </div>

      <div className="no-print flex items-center gap-2">
        <button
          onClick={() => window.print()}
          className="inline-flex items-center gap-2 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 transition-colors"
        >
          <Printer className="h-4 w-4" /> Imprimer
        </button>
        <button
          onClick={downloadPdf}
          className="inline-flex items-center gap-2 rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50 transition-colors"
        >
          <Download className="h-4 w-4" /> Télécharger PDF
        </button>
      </div>
    </div>
  );
};