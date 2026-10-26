import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats as Formats } from 'html5-qrcode';

const REGION_ID = 'barcode-scanner-region';
const FORMATS = [Formats.EAN_13, Formats.EAN_8, Formats.UPC_A, Formats.UPC_E, Formats.CODE_128, Formats.CODE_39];

// Serializa arranques y paradas de la cámara (React monta dos veces en desarrollo)
let queue = Promise.resolve();

const describeError = (err) => {
  const text = `${err?.name || ''} ${err?.message || err}`;
  if (/NotAllowed|Permission/i.test(text)) {
    return 'No hay permiso para usar la cámara. Habilitala desde el candado junto a la dirección del sitio y volvé a intentar.';
  }
  if (/NotFound|Devices/i.test(text)) return 'No se encontró una cámara en este dispositivo.';
  if (/NotReadable|TrackStart/i.test(text)) return 'La cámara está siendo usada por otra aplicación.';
  return 'No se pudo iniciar la cámara.';
};

const BarcodeScanner = ({ onDetected, onClose }) => {
  const [error, setError] = useState('');
  const onDetectedRef = useRef(onDetected);
  const doneRef = useRef(false);
  onDetectedRef.current = onDetected;

  useEffect(() => {
    let cancelled = false;
    let scanner = null;

    queue = queue.then(async () => {
      if (cancelled) return;
      scanner = new Html5Qrcode(REGION_ID, {
        formatsToSupport: FORMATS,
        verbose: false,
        experimentalFeatures: { useBarCodeDetectorIfSupported: true },
      });
      try {
        await scanner.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 280, height: 120 } },
          (text) => {
            if (doneRef.current) return;
            doneRef.current = true;
            if (navigator.vibrate) navigator.vibrate(80);
            onDetectedRef.current(text);
          },
          () => {},
        );
      } catch (err) {
        if (!cancelled) setError(describeError(err));
      }
    });

    return () => {
      cancelled = true;
      queue = queue.then(async () => {
        if (!scanner) return;
        try {
          if (scanner.isScanning) await scanner.stop();
          scanner.clear();
        } catch (err) {
          // la cámara ya estaba detenida
        }
      });
    };
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="scanner-overlay" onClick={onClose}>
      <div
        className="scanner-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Escanear código de barras"
        onClick={(e) => e.stopPropagation()}
      >
        <h3>Escanear código de barras</h3>
        <div id={REGION_ID} className="scanner-region" />
        {error ? (
          <p className="error">{error}</p>
        ) : (
          <p className="report-note">Apuntá la cámara al código, a unos 15 cm, con buena luz.</p>
        )}
        <button type="button" onClick={onClose}>
          Cancelar
        </button>
      </div>
    </div>
  );
};

export default BarcodeScanner;
