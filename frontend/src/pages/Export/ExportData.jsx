import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { getExportStatus, downloadBusinessExport } from '../../api/export.api.js';
import { saveBlob, filenameFromResponse, errorMessageFrom } from '../../utils/download.js';
import Spinner from '../../components/common/Spinner.jsx';
import './ExportData.css';

const formatDate = (value) =>
  new Date(value).toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' });

const ExportData = () => {
  const { role, isClosing, logout } = useAuth();
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');
  const [downloaded, setDownloaded] = useState(false);

  const isAdmin = role === 'admin';

  useEffect(() => {
    if (!isAdmin) {
      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    (async () => {
      try {
        const { data } = await getExportStatus();
        if (cancelled) return;
        setStatus(data);
        if (data.status === 'active' && isClosing) logout();
      } catch (err) {
        if (!cancelled) setError(await errorMessageFrom(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isAdmin, isClosing, logout]);

  const handleDownload = async () => {
    setError('');
    setDownloaded(false);
    setDownloading(true);
    try {
      const response = await downloadBusinessExport();
      saveBlob(response.data, filenameFromResponse(response, 'talarix-datos.xlsx'));
      setDownloaded(true);
    } catch (err) {
      setError(await errorMessageFrom(err));
    } finally {
      setDownloading(false);
    }
  };

  if (loading) return <Spinner label="Cargando..." />;

  if (!isAdmin) {
    return (
      <div className="export-page">
        <h1>Exportar mis datos</h1>
        <p>
          {isClosing
            ? 'Este comercio está en proceso de baja. Solo el administrador puede descargar los datos.'
            : 'Solo el administrador del comercio puede exportar los datos.'}
        </p>
      </div>
    );
  }

  return (
    <div className="export-page">
      <h1>Exportar mis datos</h1>

      {status?.status === 'closing' && status.deleteAt && (
        <div className="export-closing" role="status">
          <strong>Tu cuenta está en proceso de baja.</strong> Podés descargar tus datos hasta el{' '}
          {formatDate(status.deleteAt)}. Ese día se eliminan definitivamente. Si fue un error, escribinos y cancelamos
          la baja.
        </div>
      )}

      <p>
        Descargá un archivo Excel con todos los datos de tu comercio: productos, combos, clientes, proveedores, compras,
        remitos, formas de pago, movimientos de stock y usuarios. No incluye contraseñas.
      </p>

      {error && <p className="error">{error}</p>}
      {downloaded && (
        <p className="export-ok" role="status">
          Listo, el archivo se descargó.
        </p>
      )}

      <div className="export-actions">
        <button type="button" onClick={handleDownload} disabled={downloading}>
          {downloading ? 'Preparando archivo…' : 'Descargar Excel'}
        </button>
      </div>

      <p className="export-note">Por seguridad se puede exportar un máximo de 5 veces por hora.</p>
    </div>
  );
};

export default ExportData;
