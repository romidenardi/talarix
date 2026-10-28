import { useEffect, useState } from 'react';
import { useDialog } from '../../context/DialogContext.jsx';
import * as tablesApi from '../../api/tables.api.js';
import FormMessage from '../../components/common/FormMessage.jsx';
import Spinner from '../../components/common/Spinner.jsx';
import { useMessage } from '../../hooks/useMessage.js';
import { serverMessage } from '../../utils/serverErrors.js';

const EMPTY = { name: '', area: '', sortOrder: '' };

// Alta y cambios de mesas (administrador y editor)
export default function TablesSettings() {
  const dialog = useDialog();
  const msg = useMessage();
  const [tables, setTables] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState(null);

  const load = async () => {
    try {
      const { data } = await tablesApi.getTables();
      setTables(data);
    } catch (err) {
      msg.error(serverMessage(err, 'No se pudieron cargar las mesas'), 'list');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const payload = (f) => ({
    name: f.name.trim(),
    area: f.area.trim() || null,
    ...(String(f.sortOrder).trim() !== '' ? { sortOrder: Number(f.sortOrder) } : {}),
  });

  const create = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return msg.error('Escribí el número o nombre de la mesa', 'create');
    try {
      await tablesApi.createTable(payload(form));
      setForm({ ...EMPTY, area: form.area });
      await load();
      msg.success('Mesa agregada', 'create');
    } catch (err) {
      msg.error(serverMessage(err, 'No se pudo agregar la mesa'), 'create');
    }
    return undefined;
  };

  const save = async (e) => {
    e.preventDefault();
    try {
      await tablesApi.updateTable(editing.id, { ...payload(editing), active: editing.active });
      const id = editing.id;
      setEditing(null);
      await load();
      msg.success('Cambios guardados', id);
    } catch (err) {
      msg.error(serverMessage(err, 'No se pudo guardar la mesa'), editing.id);
    }
  };

  const remove = async (table) => {
    if (
      !(await dialog.confirm({ message: `¿Eliminar la mesa ${table.name}?`, confirmLabel: 'Eliminar', danger: true }))
    )
      return;
    try {
      await tablesApi.deleteTable(table.id);
      await load();
    } catch (err) {
      msg.error(serverMessage(err, 'No se pudo eliminar la mesa'), table.id);
    }
  };

  if (loading) return <Spinner label="Cargando mesas..." />;

  return (
    <div className="tables-settings">
      <form className="inline-edit-form" onSubmit={create}>
        <div className="field">
          <label htmlFor="table-name">Mesa (número o nombre)</label>
          <input
            id="table-name"
            maxLength={30}
            placeholder="Ej: 12"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="table-area">Sector (opcional)</label>
          <input
            id="table-area"
            maxLength={50}
            placeholder="Ej: Vereda"
            value={form.area}
            onChange={(e) => setForm({ ...form, area: e.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="table-order">Orden (opcional)</label>
          <input
            id="table-order"
            type="number"
            min="0"
            value={form.sortOrder}
            onChange={(e) => setForm({ ...form, sortOrder: e.target.value })}
          />
        </div>
        <div className="inline-edit-actions">
          <button type="submit">Agregar mesa</button>
        </div>
        <FormMessage message={msg.at('create')} onClose={msg.clear} />
      </form>

      <FormMessage message={msg.at('list')} onClose={msg.clear} />
      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Mesa</th>
              <th>Sector</th>
              <th>Orden</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {tables.length === 0 && (
              <tr>
                <td colSpan={5} className="list-search-empty">
                  Todavía no hay mesas
                </td>
              </tr>
            )}
            {tables.map((table) =>
              editing?.id === table.id ? (
                <tr key={table.id}>
                  <td colSpan={5} className="edit-cell">
                    <form className="inline-edit-form" onSubmit={save}>
                      <div className="field">
                        <label htmlFor={`table-${table.id}-name`}>Mesa</label>
                        <input
                          id={`table-${table.id}-name`}
                          maxLength={30}
                          value={editing.name}
                          onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                        />
                      </div>
                      <div className="field">
                        <label htmlFor={`table-${table.id}-area`}>Sector</label>
                        <input
                          id={`table-${table.id}-area`}
                          maxLength={50}
                          value={editing.area}
                          onChange={(e) => setEditing({ ...editing, area: e.target.value })}
                        />
                      </div>
                      <div className="field">
                        <label htmlFor={`table-${table.id}-order`}>Orden</label>
                        <input
                          id={`table-${table.id}-order`}
                          type="number"
                          min="0"
                          value={editing.sortOrder}
                          onChange={(e) => setEditing({ ...editing, sortOrder: e.target.value })}
                        />
                      </div>
                      <div className="field">
                        <label htmlFor={`table-${table.id}-active`}>Estado</label>
                        <select
                          id={`table-${table.id}-active`}
                          value={String(editing.active)}
                          onChange={(e) => setEditing({ ...editing, active: e.target.value === 'true' })}
                        >
                          <option value="true">Activa</option>
                          <option value="false">Inactiva</option>
                        </select>
                      </div>
                      <div className="inline-edit-actions">
                        <button type="submit">Guardar</button>
                        <button type="button" onClick={() => setEditing(null)}>
                          Cancelar
                        </button>
                      </div>
                      <FormMessage message={msg.at(table.id)} onClose={msg.clear} />
                    </form>
                  </td>
                </tr>
              ) : (
                <tr key={table.id}>
                  <td data-label="Mesa">{table.name}</td>
                  <td data-label="Sector">{table.area || '—'}</td>
                  <td data-label="Orden">{table.sortOrder}</td>
                  <td data-label="Estado">{table.active ? 'Activa' : 'Inactiva'}</td>
                  <td data-label="Acciones">
                    <button
                      type="button"
                      onClick={() =>
                        setEditing({
                          id: table.id,
                          name: table.name,
                          area: table.area || '',
                          sortOrder: table.sortOrder,
                          active: table.active,
                        })
                      }
                    >
                      Editar
                    </button>
                    <button type="button" onClick={() => remove(table)}>
                      Eliminar
                    </button>
                    <FormMessage message={msg.at(table.id)} onClose={msg.clear} />
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
