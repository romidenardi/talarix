import { useState } from 'react';
import { importProducts, importCustomers, importSuppliers } from '../../api/imports.api.js';
import FormMessage from '../../components/common/FormMessage.jsx';
import { useMessage } from '../../hooks/useMessage.js';
import { serverMessage } from '../../utils/serverErrors.js';

// Cada tipo: columnas de la plantilla (con una fila de ejemplo) y ayuda
const IMPORT_TYPES = [
  {
    key: 'products',
    label: 'Productos',
    fn: importProducts,
    template: [
      ['Código Interno', 'Nombre', 'Marca', 'Categoría', 'Precio', 'Costo', 'IVA', 'Unidad', 'PLU Balanza', 'Código de Barras'],
      ['YER1', 'Yerba 1 kg', 'Playadito', 'Almacén', '4500', '3100,50', '21', 'unidad', '', '7790387000017'],
      ['QUE1', 'Queso cremoso', '', 'Fiambrería', '12.500', '8.200', '10,5', 'kg', '417', ''],
    ],
    help: [
      'Obligatorias: Código Interno, Nombre y Precio. El resto es opcional.',
      'Precio y Costo con coma o punto decimal: 1234,50 · 1.234,50 · 1234.50. En productos por peso son por kg.',
      'IVA: 21, 10,5 o 0 (vacío = 21). También se puede agregar la columna "Impuestos Internos" (%).',
      'Unidad: "unidad" o "peso" (también kg, kilo o granel). Vacía = unidad.',
      'Categoría: se busca sin importar tildes ni mayúsculas. Si no existe, se crea.',
      'PLU Balanza: solo para productos por peso, entre 1 y 9999.',
      'Si un código interno ya existe en el sistema, esa fila se saltea: el producto no se modifica.',
    ],
  },
  {
    key: 'customers',
    label: 'Clientes',
    fn: importCustomers,
    template: [
      ['Razón Social', 'Nombre', 'Apellido', 'Condición Fiscal', 'CUIT', 'Dirección', 'Localidad', 'Provincia', 'Teléfono', 'Email'],
      ['Distribuidora Norte SRL', '', '', 'Responsable Inscripto', '30-71234567-1', 'San Martín 123', 'Rafaela', 'Santa Fe', '3492 123456', 'compras@norte.com.ar'],
      ['', 'Ana', 'Pérez', 'Consumidor Final', '', '', 'Rafaela', 'Santa Fe', '', ''],
    ],
    help: [
      'Obligatorias: Razón Social o Nombre, y Condición Fiscal.',
      'Condición Fiscal: Consumidor Final, Responsable Inscripto, Monotributista o Exento (también sirven CF, RI, Monotributo).',
      'Si ya existe un cliente con el mismo CUIT (o, sin CUIT, con el mismo nombre), esa fila se saltea.',
    ],
  },
  {
    key: 'suppliers',
    label: 'Proveedores',
    fn: importSuppliers,
    template: [
      ['Nombre', 'CUIT', 'Contacto', 'Teléfono', 'Email', 'Dirección', 'Localidad', 'Provincia'],
      ['Lácteos del Centro SA', '30-70987654-2', 'Marcela', '3492 654321', 'ventas@lacteos.com.ar', 'Ruta 34 km 230', 'Rafaela', 'Santa Fe'],
    ],
    help: [
      'Obligatoria: Nombre.',
      'Si ya existe un proveedor con el mismo CUIT (o, sin CUIT, con el mismo nombre), esa fila se saltea.',
    ],
  },
];

// Plantilla CSV con punto y coma: es lo que espera el Excel configurado en castellano
const downloadTemplate = (type) => {
  const cell = (value) => (/[;"\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  const csv = type.template.map((row) => row.map(cell).join(';')).join('\r\n');
  const blob = new Blob([`﻿${csv}\r\n`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `plantilla-${type.key}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

const RowsTable = ({ rows }) => (
  <table>
    <thead>
      <tr>
        <th>Fila</th>
        <th>Motivo</th>
      </tr>
    </thead>
    <tbody>
      {rows.map((item) => (
        <tr key={`${item.row}-${item.message}`}>
          <td>{item.row}</td>
          <td>{item.message}</td>
        </tr>
      ))}
    </tbody>
  </table>
);

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

const Imports = () => {
  const [selectedType, setSelectedType] = useState('products');
  const [file, setFile] = useState(null);
  const [inputKey, setInputKey] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);
  const msg = useMessage();

  const current = IMPORT_TYPES.find((t) => t.key === selectedType);

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!file) {
      msg.error('Elegí un archivo primero');
      return;
    }
    msg.clear();
    setUploading(true);
    setResult(null);
    try {
      const { data } = await current.fn(file);
      setResult(data);
      if (data.imported) {
        const parts = [plural(data.created, 'fila importada', 'filas importadas')];
        if (data.skipped.length) parts.push(plural(data.skipped.length, 'salteada (ya existía)', 'salteadas (ya existían)'));
        msg.success(parts.join(', '));
        setFile(null);
        setInputKey((k) => k + 1);
      } else {
        msg.error(`No se importó nada: ${plural(data.errors.length, 'fila tiene', 'filas tienen')} errores. Corregilas y volvé a subir el archivo completo.`);
      }
    } catch (err) {
      msg.error(serverMessage(err, 'Error al importar el archivo'));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="imports-page">
      <h1>Importar desde Excel / CSV</h1>

      <form onSubmit={onSubmit} className="import-form">
        <select value={selectedType} onChange={(e) => { setSelectedType(e.target.value); setResult(null); msg.clear(); }}>
          {IMPORT_TYPES.map((t) => (
            <option key={t.key} value={t.key}>{t.label}</option>
          ))}
        </select>

        <input
          key={inputKey}
          type="file"
          accept=".csv,.xlsx,.xls"
          onChange={(e) => { setFile(e.target.files[0]); msg.clear(); }}
        />

        <button type="submit" disabled={uploading}>
          {uploading ? 'Importando...' : 'Importar'}
        </button>
      </form>
      <FormMessage message={msg.message} onClose={msg.clear} />

      <div className="import-hint">
        <p>
          <strong>{current.label}:</strong>{' '}
          <button type="button" className="link-button" onClick={() => downloadTemplate(current)}>
            descargar planilla de ejemplo
          </button>{' '}
          (se abre con Excel; completala y guardala como .xlsx o .csv).
        </p>
        <ul>
          {current.help.map((line) => <li key={line}>{line}</li>)}
        </ul>
        <p>
          Archivos .xlsx, .xls o .csv de hasta 5 MB y 5.000 filas. Se lee solo la primera hoja.
          <strong> Si una fila tiene un error, no se importa ninguna:</strong> corregí las filas marcadas y volvé a subir el archivo.
        </p>
      </div>

      {result && (
        <div className="import-result">
          {result.imported && (
            <p className="import-success">{plural(result.created, 'fila importada', 'filas importadas')} correctamente.</p>
          )}
          {result.notes?.map((note) => <p key={note} className="import-note">{note}</p>)}

          {result.errors.length > 0 && (
            <>
              <p className="import-error-title">
                {plural(result.errors.length, 'fila con errores', 'filas con errores')} (no se importó nada):
              </p>
              <RowsTable rows={result.errors} />
            </>
          )}

          {result.skipped.length > 0 && (
            <>
              <p className="import-skipped-title">
                {plural(result.skipped.length, 'fila salteada', 'filas salteadas')}
                {result.imported ? '' : ' (se van a saltear también cuando corrijas los errores)'}:
              </p>
              <RowsTable rows={result.skipped} />
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default Imports;
