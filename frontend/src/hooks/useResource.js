import { useEffect, useState, useCallback } from 'react';
import { serverMessage } from '../utils/serverErrors.js';

// Carga y modifica una lista (clientes, proveedores, etc.). No muestra avisos: devuelve el resultado
// y cada pantalla lo muestra donde corresponde (junto al botón, en la fila o debajo del campo).
//
// Después de un alta, un cambio o una baja, la lista se actualiza con lo que devolvió el servidor,
// sin volver a pedir todo. Las pantallas cuyos datos dependen de otros registros (categorías con
// subcategorías, productos con combos) piden `{ reloadAfterChange: true }` y recargan la lista entera.
export const useResource = (api, { reloadAfterChange = false } = {}) => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.getAll();
      setItems(data);
      setLoadError('');
    } catch {
      setLoadError('No se pudo cargar la información. Recargá la página.');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    load();
  }, [load]);

  // Aplica el cambio a la lista: con la respuesta del servidor, o recargando si no alcanza
  const apply = async (change) => {
    if (reloadAfterChange || !change) {
      await load();
      return;
    }
    setItems(change);
  };

  // result: { success: true, data } o { success: false, message, error }
  const run = async (action, fallback, toChange) => {
    try {
      const response = await action();
      const data = response?.data;
      await apply(toChange(data));
      return { success: true, data };
    } catch (err) {
      return { success: false, message: serverMessage(err, fallback), error: err };
    }
  };

  const hasId = (data) => data && typeof data === 'object' && data.id !== undefined;

  const create = (payload) =>
    run(
      () => api.create(payload),
      'No se pudo crear',
      (data) => (hasId(data) ? (prev) => [...prev, data] : null),
    );

  const update = (id, payload) =>
    run(
      () => api.update(id, payload),
      'No se pudo guardar',
      (data) => (hasId(data) ? (prev) => prev.map((item) => (item.id === id ? { ...item, ...data } : item)) : null),
    );

  const remove = (id) =>
    run(
      () => api.remove(id),
      'No se pudo eliminar',
      () => (prev) => prev.filter((item) => item.id !== id),
    );

  return { items, loading, loadError, create, update, remove, reload: load };
};
