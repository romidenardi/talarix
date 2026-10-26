import { useState } from 'react';
import BarcodeScanner from './BarcodeScanner.jsx';

const ScanBar = ({ onScan }) => {
  const [value, setValue] = useState('');
  const [cameraOpen, setCameraOpen] = useState(false);

  const submit = () => {
    const code = value.trim();
    setValue('');
    if (code) onScan(code);
  };

  return (
    <div className="field field-full scan-bar">
      <label htmlFor="scan-input">Escanear código de barras</label>
      <div className="input-with-action">
        <input
          id="scan-input"
          value={value}
          autoComplete="off"
          placeholder="Apuntá el lector acá o escribí el código y Enter"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault(); // el lector manda Enter: no debe enviar el formulario
              submit();
            }
          }}
        />
        <button type="button" className="scan-button" onClick={() => setCameraOpen(true)}>
          Cámara
        </button>
      </div>
      {cameraOpen && (
        <BarcodeScanner
          onClose={() => setCameraOpen(false)}
          onDetected={(code) => {
            setCameraOpen(false);
            onScan(code);
          }}
        />
      )}
    </div>
  );
};

export default ScanBar;
