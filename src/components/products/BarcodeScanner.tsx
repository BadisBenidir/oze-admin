import React, { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader, IScannerControls } from '@zxing/browser';
import { DecodeHintType, BarcodeFormat } from '@zxing/library';
import { Camera, AlertCircle } from 'lucide-react';

interface BarcodeScannerProps {
  /** Appelé à chaque lecture réussie d'un code-barres. */
  onDetected: (code: string) => void;
}

/**
 * Lecteur de code-barres via la caméra (arrière de préférence) de l'appareil.
 * Conçu pour iPad/Safari : `playsInline` + `muted`. La caméra n'est dispo qu'en
 * HTTPS (ok sur admin.ozeparis.com).
 */
export const BarcodeScanner: React.FC<BarcodeScannerProps> = ({ onDetected }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const onDetectedRef = useRef(onDetected);
  onDetectedRef.current = onDetected;

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // On restreint au QR Code (notre symbologie d'étiquette) + TRY_HARDER : un QR
    // se lit bien plus facilement à la caméra qu'un code-barres fin sur petite étiquette.
    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE]);
    hints.set(DecodeHintType.TRY_HARDER, true);
    const reader = new BrowserMultiFormatReader(hints);
    let cancelled = false;

    reader
      .decodeFromConstraints(
        {
          // Haute résolution = barres fines mieux résolues (lecture de plus loin).
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
        },
        videoRef.current!,
        (result, _err, controls) => {
          if (!controlsRef.current && controls) controlsRef.current = controls;
          if (result) onDetectedRef.current(result.getText());
        },
      )
      .then((controls) => {
        if (cancelled) controls.stop();
        else controlsRef.current = controls;
      })
      .catch((e: unknown) => {
        setError(
          e instanceof DOMException && e.name === 'NotAllowedError'
            ? "Accès caméra refusé. Autorise la caméra pour ce site dans Safari."
            : "Impossible d'ouvrir la caméra : " + (e as Error).message,
        );
      });

    return () => {
      cancelled = true;
      controlsRef.current?.stop();
    };
  }, []);

  if (error) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
        <AlertCircle className="h-5 w-5 flex-shrink-0" />
        <span>{error}</span>
      </div>
    );
  }

  return (
    <div className="relative w-full overflow-hidden rounded-xl bg-black">
      <video ref={videoRef} className="w-full aspect-square object-cover" muted playsInline />
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="aspect-square w-3/5 rounded-lg border-2 border-white/80" />
      </div>
      <div className="absolute bottom-2 left-0 right-0 flex items-center justify-center gap-2 text-xs text-white/90">
        <Camera className="h-4 w-4" /> Vise le QR Code de l'étiquette
      </div>
    </div>
  );
};