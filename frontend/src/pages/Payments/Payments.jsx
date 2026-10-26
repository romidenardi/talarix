import { useState } from 'react';
import { useDialog } from '../../context/DialogContext.jsx';
import { useForm, useFieldArray } from 'react-hook-form';
import { useResource } from '../../hooks/useResource.js';
import * as paymentsApi from '../../api/payments.api.js';
import Spinner from '../../components/common/Spinner.jsx';
import { RequiredMark, RequiredLegend } from '../../components/common/Required.jsx';
import FormMessage from '../../components/common/FormMessage.jsx';
import { useMessage } from '../../hooks/useMessage.js';
import { applyServerFieldErrors } from '../../utils/serverErrors.js';

const api = {
  getAll: paymentsApi.getPayments,
  create: paymentsApi.createPayment,
  update: paymentsApi.updatePayment,
  remove: paymentsApi.deletePayment,
};

const emptyPlan = { installments: '', interestRate: '' };

const buildPlansPayload = (hasInstallments, plans) => {
  if (!hasInstallments) return [];
  return plans
    .filter((p) => p.installments)
    .map((p) => ({ installments: Number(p.installments), interestRate: Number(p.interestRate) || 0 }));
};

const Payments = () => {
  const { items: payments, loading, loadError, create, update, remove } = useResource(api);
  const msg = useMessage();
  const dialog = useDialog();
  const [editingId, setEditingId] = useState(null);

  const createForm = useForm({
    defaultValues: { name: '', hasInstallments: false, installmentPlans: [emptyPlan] },
  });
  const { register, handleSubmit, reset, watch, control, setError, formState: { errors } } = createForm;
  const { fields, append, remove: removePlanField } = useFieldArray({ control, name: 'installmentPlans' });
  const hasInstallments = watch('hasInstallments');

  const editForm = useForm();
  const { errors: editErrors } = editForm.formState;
  const editPlans = useFieldArray({ control: editForm.control, name: 'installmentPlans' });
  const editHasInstallments = editForm.watch('hasInstallments');

  const onCreate = async (formData) => {
    const result = await create({
      name: formData.name,
      active: true,
      installmentPlans: buildPlansPayload(formData.hasInstallments, formData.installmentPlans),
    });
    if (result.success) {
      reset({ name: '', hasInstallments: false, installmentPlans: [emptyPlan] });
      msg.success('Forma de pago agregada', 'create');
    } else if (!applyServerFieldErrors(result.error, setError, ['name'])) {
      msg.error(result.message, 'create');
    }
  };

  const startEdit = (payment) => {
    setEditingId(payment.id);
    msg.clear();
    const plans = payment.installmentPlans && payment.installmentPlans.length > 0
      ? payment.installmentPlans.map((p) => ({ installments: p.installments, interestRate: p.interestRate }))
      : [emptyPlan];
    editForm.reset({
      name: payment.name,
      active: String(payment.active),
      hasInstallments: (payment.installmentPlans || []).length > 0,
      installmentPlans: plans,
    });
  };

  const onUpdate = async (formData) => {
    const result = await update(editingId, {
      name: formData.name,
      active: formData.active === 'true',
      installmentPlans: buildPlansPayload(formData.hasInstallments, formData.installmentPlans),
    });
    if (result.success) {
      const savedId = editingId;
      setEditingId(null);
      msg.success('Cambios guardados', savedId);
    } else if (!applyServerFieldErrors(result.error, editForm.setError, ['name'])) {
      msg.error(result.message, 'edit');
    }
  };

  const onDelete = async (id) => {
    if (!(await dialog.confirm({ message: '¿Eliminar esta forma de pago?', confirmLabel: 'Eliminar', danger: true }))) return;
    const result = await remove(id);
    if (result.success) msg.success('Forma de pago eliminada', 'list');
    else msg.error(result.message, id);
  };

  const planSummary = (payment) => {
    if (!payment.installmentPlans || payment.installmentPlans.length === 0) return 'Sin cuotas';
    return payment.installmentPlans
      .map((p) => `${p.installments} cuotas (${Number(p.interestRate) > 0 ? `+${p.interestRate}% interés` : 'sin interés'})`)
      .join(' · ');
  };

  if (loading) return <Spinner label="Cargando formas de pago..." />;

  return (
    <div className="payments-page">
      <h1>Formas de pago</h1>
      <FormMessage message={loadError ? { type: 'error', text: loadError } : null} />

      <form onSubmit={handleSubmit(onCreate)} className="payment-form">
        <div className="field">
          <label htmlFor="name">Nombre<RequiredMark /></label>
          <input
            id="name"
            placeholder="Ej: Tarjeta de crédito"
            {...register('name', { required: 'El nombre es obligatorio' })}
          />
          {errors.name && <span className="error">{errors.name.message}</span>}
        </div>

        <div className="field">
          <label htmlFor="hasInstallments">¿Tiene planes de cuotas?</label>
          <input id="hasInstallments" type="checkbox" {...register('hasInstallments')} />
        </div>

        {hasInstallments && (
          <div className="purchase-items">
            {fields.map((field, index) => (
              <div key={field.id} className="purchase-item-row">
                <div className="field">
                  <label htmlFor={`plan-installments-${index}`}>Cantidad de cuotas</label>
                  <input
                    id={`plan-installments-${index}`}
                    type="number"
                    min="1"
                    placeholder="Ej: 6"
                    {...register(`installmentPlans.${index}.installments`)}
                  />
                </div>
                <div className="field">
                  <label htmlFor={`plan-interest-${index}`}>Interés (%)</label>
                  <input
                    id={`plan-interest-${index}`}
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="Ej: 15 (dejá 0 si es sin interés)"
                    {...register(`installmentPlans.${index}.interestRate`)}
                  />
                </div>
                <div className="field item-remove-field">
                  <label aria-hidden="true">&nbsp;</label>
                  <button
                    type="button"
                    onClick={() => removePlanField(index)}
                    disabled={fields.length === 1}
                    style={{ visibility: fields.length === 1 ? 'hidden' : 'visible' }}
                  >
                    Quitar
                  </button>
                </div>
              </div>
            ))}
            <button type="button" onClick={() => append(emptyPlan)}>+ Agregar plan de cuotas</button>
          </div>
        )}

        <button type="submit">Agregar forma de pago</button>
        <FormMessage message={msg.at('create')} onClose={msg.clear} />
        <RequiredLegend />
      </form>

      <FormMessage message={msg.at('list')} />
      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Planes de cuotas</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {payments.map((payment) => (
              <tr key={payment.id}>
                {editingId === payment.id ? (
                  <td colSpan={4} className="edit-cell">
                    <form onSubmit={editForm.handleSubmit(onUpdate)} className="inline-edit-form">
                      <div className="field">
                        <label htmlFor={`edit-name-${payment.id}`}>Nombre<RequiredMark /></label>
                        <input
                          id={`edit-name-${payment.id}`}
                          placeholder="Ej: Tarjeta de crédito"
                          {...editForm.register('name', { required: 'El nombre es obligatorio' })}
                        />
                        {editErrors.name && <span className="error">{editErrors.name.message}</span>}
                      </div>
                      <div className="field">
                        <label htmlFor={`edit-active-${payment.id}`}>Estado</label>
                        <select id={`edit-active-${payment.id}`} {...editForm.register('active')}>
                          <option value="true">Activa</option>
                          <option value="false">Inactiva</option>
                        </select>
                      </div>
                      <div className="field">
                        <label htmlFor={`edit-hasInstallments-${payment.id}`}>¿Tiene planes de cuotas?</label>
                        <input
                          id={`edit-hasInstallments-${payment.id}`}
                          type="checkbox"
                          {...editForm.register('hasInstallments')}
                        />
                      </div>

                      {editHasInstallments && (
                        <div className="purchase-items">
                          {editPlans.fields.map((field, index) => (
                            <div key={field.id} className="purchase-item-row">
                              <div className="field">
                                <label htmlFor={`edit-plan-installments-${payment.id}-${index}`}>Cantidad de cuotas</label>
                                <input
                                  id={`edit-plan-installments-${payment.id}-${index}`}
                                  type="number"
                                  min="1"
                                  placeholder="Ej: 6"
                                  {...editForm.register(`installmentPlans.${index}.installments`)}
                                />
                              </div>
                              <div className="field">
                                <label htmlFor={`edit-plan-interest-${payment.id}-${index}`}>Interés (%)</label>
                                <input
                                  id={`edit-plan-interest-${payment.id}-${index}`}
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  placeholder="Ej: 15 (dejá 0 si es sin interés)"
                                  {...editForm.register(`installmentPlans.${index}.interestRate`)}
                                />
                              </div>
                              <div className="field item-remove-field">
                                <label aria-hidden="true">&nbsp;</label>
                                <button
                                  type="button"
                                  onClick={() => editPlans.remove(index)}
                                  disabled={editPlans.fields.length === 1}
                                  style={{ visibility: editPlans.fields.length === 1 ? 'hidden' : 'visible' }}
                                >
                                  Quitar
                                </button>
                              </div>
                            </div>
                          ))}
                          <button type="button" onClick={() => editPlans.append(emptyPlan)}>+ Agregar plan de cuotas</button>
                        </div>
                      )}

                      <div className="inline-edit-actions">
                        <button type="submit">Guardar</button>
                        <button type="button" onClick={() => setEditingId(null)}>Cancelar</button>
                      </div>
                      <FormMessage message={msg.at('edit')} onClose={msg.clear} />
                      <RequiredLegend />
                    </form>
                  </td>
                ) : (
                  <>
                    <td data-label="Nombre">{payment.name}</td>
                    <td data-label="Planes de cuotas">{planSummary(payment)}</td>
                    <td data-label="Estado">{payment.active ? 'Activa' : 'Inactiva'}</td>
                    <td data-label="Acciones">
                      <button onClick={() => startEdit(payment)}>Editar</button>
                      <button onClick={() => onDelete(payment.id)}>Eliminar</button>
                      <FormMessage message={msg.at(payment.id)} onClose={msg.clear} />
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default Payments;