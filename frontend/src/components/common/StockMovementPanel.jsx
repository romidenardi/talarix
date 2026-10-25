import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { getMovementsByProduct, createStockMovement } from '../../api/stockMovements.api.js';
import FormMessage from './FormMessage.jsx';
import { useMessage } from '../../hooks/useMessage.js';
import { serverMessage } from '../../utils/serverErrors.js';
import Spinner from './Spinner.jsx';
import { formatQuantity, formatSignedQuantity, quantityStep } from '../../utils/quantity.js';
import { RequiredMark, RequiredLegend } from './Required.jsx';

const MOVEMENT_TYPES = { in: 'Ingreso', out: 'Egreso', adjustment: 'Ajuste' };

const StockMovementPanel = ({ product, onStockChange }) => {
  const [movements, setMovements] = useState([]);
  const [loading, setLoading] = useState(true);
  const msg = useMessage();
  const { register, handleSubmit, watch, reset } = useForm({ defaultValues: { type: 'in' } });

  const type = watch('type');

  const loadMovements = async () => {
    setLoading(true);
    try {
      const { data } = await getMovementsByProduct(product.id);
      setMovements(data);
    } catch (err) {
      msg.error('No se pudo cargar el historial', 'history');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMovements();
  }, [product.id]);

  const onSubmit = async (formData) => {
    try {
      const payload = { productId: product.id, type: formData.type, reason: formData.reason };
      if (formData.type === 'adjustment') {
        payload.newStock = Number(formData.value);
      } else {
        payload.quantity = Number(formData.value);
      }
      await createStockMovement(payload);
      reset({ type: 'in' });
      loadMovements();
      msg.success('Movimiento registrado');
      onStockChange();
    } catch (err) {
      msg.error(serverMessage(err, 'Error al registrar el movimiento'));
    }
  };

  return (
    <div className="stock-panel">
      <h3>Stock actual: {formatQuantity(product.stock, product.unitType)}</h3>

      <form onSubmit={handleSubmit(onSubmit)} className="stock-form">
        <div className="field">
          <label htmlFor={`stock-type-${product.id}`}>Tipo de movimiento</label>
          <select id={`stock-type-${product.id}`} {...register('type')}>
            <option value="in">Ingreso</option>
            <option value="out">Egreso</option>
            <option value="adjustment">Ajuste (conteo físico)</option>
          </select>
        </div>

        <div className="field">
          <label htmlFor={`stock-value-${product.id}`}>
            {type === 'adjustment' ? 'Stock real contado' : 'Cantidad'}<RequiredMark />
          </label>
          <input
            id={`stock-value-${product.id}`}
            type="number"
            step={quantityStep(product.unitType)}
            placeholder={type === 'adjustment'
              ? (product.unitType === 'weight' ? 'Ej: 24,500' : 'Ej: 24')
              : (product.unitType === 'weight' ? 'Ej: 10,250' : 'Ej: 10')}
            {...register('value', { required: true, min: 0 })}
          />
        </div>

        <div className="field">
          <label htmlFor={`stock-reason-${product.id}`}>Motivo (opcional)</label>
          <input
            id={`stock-reason-${product.id}`}
            placeholder="Ej: Compra a proveedor"
            {...register('reason')}
          />
        </div>

        <button type="submit">Registrar</button>
        <FormMessage message={msg.at()} onClose={msg.clear} />
        <RequiredLegend />
      </form>

      {loading ? (
        <Spinner label="Cargando historial..." />
      ) : msg.at('history') ? (
        <FormMessage message={msg.at('history')} />
      ) : (
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Tipo</th>
                <th>Cambio</th>
                <th>Motivo</th>
                <th>Usuario</th>
              </tr>
            </thead>
            <tbody>
              {movements.map((m) => (
                <tr key={m.id}>
                  <td data-label="Fecha">{new Date(m.date).toLocaleString('es-AR')}</td>
                  <td data-label="Tipo">{MOVEMENT_TYPES[m.type] || m.type}</td>
                  <td data-label="Cambio">{formatSignedQuantity(m.quantity, product.unitType)}</td>
                  <td data-label="Motivo">{m.reason || '—'}</td>
                  <td data-label="Usuario">{m.createdByName || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default StockMovementPanel;