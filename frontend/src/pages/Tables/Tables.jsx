import { useState } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import * as tablesApi from '../../api/tables.api.js';
import { serverMessage } from '../../utils/serverErrors.js';
import FormMessage from '../../components/common/FormMessage.jsx';
import { useMessage } from '../../hooks/useMessage.js';
import TablesFloor from './TablesFloor.jsx';
import Kitchen from './Kitchen.jsx';
import TipsReport from './TipsReport.jsx';
import TablesSettings from './TablesSettings.jsx';

// Mesas y comandas: el salón (abrir mesas, mandar comandas, cobrar), la pantalla de la cocina,
// las propinas por mozo y la configuración de las mesas.
export default function Tables() {
  const { role, tablesEnabled, setTablesEnabled } = useAuth();
  const isManager = role === 'admin' || role === 'editor';
  const [tab, setTab] = useState('floor');
  const [saving, setSaving] = useState(false);
  const msg = useMessage();

  const activate = async () => {
    setSaving(true);
    try {
      await tablesApi.setTablesEnabled(true);
      setTablesEnabled(true);
    } catch (err) {
      msg.error(serverMessage(err, 'No se pudieron activar las mesas'));
    } finally {
      setSaving(false);
    }
  };

  if (!tablesEnabled) {
    return (
      <div className="tables-page">
        <h1>Mesas</h1>
        <div className="tables-activate">
          <p>
            Para restaurantes, bares y cafés: cargás las mesas del salón, el mozo abre cada mesa y manda las comandas a
            la cocina, y al final se cobra la cuenta (entera o dividida, con propina). El stock baja al mandar cada
            comanda.
          </p>
          {role === 'admin' ? (
            <button type="button" className="btn-primary" onClick={activate} disabled={saving}>
              {saving ? 'Activando…' : 'Activar mesas'}
            </button>
          ) : (
            <p className="report-note">Pedile al administrador del comercio que active las mesas.</p>
          )}
          <FormMessage message={msg.at()} onClose={msg.clear} />
        </div>
      </div>
    );
  }

  const tabs = [
    ['floor', 'Salón'],
    ['kitchen', 'Cocina'],
    ...(isManager
      ? [
          ['tips', 'Propinas'],
          ['settings', 'Configurar'],
        ]
      : []),
  ];

  return (
    <div className="tables-page">
      <h1>Mesas</h1>
      <div className="report-tabs" role="tablist">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={tab === key ? 'active' : ''}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'floor' && <TablesFloor />}
      {tab === 'kitchen' && <Kitchen />}
      {tab === 'tips' && isManager && <TipsReport />}
      {tab === 'settings' && isManager && <TablesSettings />}
    </div>
  );
}
