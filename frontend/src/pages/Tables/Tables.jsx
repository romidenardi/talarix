import { useState } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import TablesFloor from './TablesFloor.jsx';
import Kitchen from './Kitchen.jsx';
import TipsReport from './TipsReport.jsx';
import TablesSettings from './TablesSettings.jsx';

// Mesas y comandas (módulo opcional que activa el superadmin): el salón (abrir mesas, mandar comandas, cobrar), la pantalla de la cocina,
// las propinas por mozo y la configuración de las mesas.
export default function Tables() {
  const { role, tablesEnabled } = useAuth();
  const isManager = role === 'admin' || role === 'editor';
  const [tab, setTab] = useState('floor');

  // El módulo lo activa Talarix (superadmin) para cada comercio
  if (!tablesEnabled) {
    return (
      <div className="tables-page">
        <h1>Mesas</h1>
        <div className="tables-activate">
          <p>El módulo de mesas y comandas no está activo para este comercio.</p>
          <p className="report-note">
            Sirve para restaurantes, bares y cafés: mesas del salón, comandas a la cocina, cuenta dividida y propinas.
            Si te interesa, escribinos a hola@talarix.com.ar.
          </p>
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
