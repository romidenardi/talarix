import { useState } from 'react';
import { useDialog } from '../../context/DialogContext.jsx';
import { useForm } from 'react-hook-form';
import { useResource } from '../../hooks/useResource.js';
import { useAuth } from '../../context/AuthContext.jsx';
import * as customersApi from '../../api/customers.api.js';
import { downloadCustomerData, anonymizeCustomer } from '../../api/dataRights.api.js';
import { saveBlob, filenameFromResponse, errorMessageFrom } from '../../utils/download.js';
import Spinner from '../../components/common/Spinner.jsx';
import SearchInput from '../../components/common/SearchInput.jsx';
import { matchesSearch } from '../../utils/search.js';
import { RequiredMark, RequiredLegend } from '../../components/common/Required.jsx';
import FormMessage from '../../components/common/FormMessage.jsx';
import { useMessage } from '../../hooks/useMessage.js';
import { applyServerFieldErrors } from '../../utils/serverErrors.js';
import { normalizeTaxId, taxIdDigits } from '../../utils/taxId.js';

// CUIT o DNI (mismas reglas que el servidor). Al editar, el que ya tenía se acepta tal cual.
const validateTaxId = (previous) => (value) => {
  if (previous && taxIdDigits(previous) && taxIdDigits(previous) === taxIdDigits(value)) return true;
  return normalizeTaxId(value).error || true;
};

const api = {
  getAll: customersApi.getCustomers,
  create: customersApi.createCustomer,
  update: customersApi.updateCustomer,
  remove: customersApi.deleteCustomer,
};

const FISCAL_CONDITIONS = ['Consumidor Final', 'Responsable Inscripto', 'Monotributista', 'Exento'];

const Customers = () => {
  const { items: customers, loading, loadError, create, update, remove, reload } = useResource(api);
  const msg = useMessage();
  const dialog = useDialog();
  const { role } = useAuth();
  const isAdmin = role === 'admin';
  const [editingId, setEditingId] = useState(null);
  const [personType, setPersonType] = useState('individual');
  const [search, setSearch] = useState('');

  const { register, handleSubmit, reset, setError, formState: { errors } } = useForm();
  const editForm = useForm();
  const { errors: editErrors } = editForm.formState;
  // Campos que muestran su error debajo (alta y edición)
  const CREATE_FIELDS = ['businessName', 'firstName', 'fiscalCondition', 'email'];
  const EDIT_FIELDS = ['email'];

  const onCreate = async (formData) => {
    const payload = {
      fiscalCondition: formData.fiscalCondition,
      cuit: formData.cuit || null,
      address: formData.address || null,
      zipCode: formData.zipCode || null,
      city: formData.city || null,
      province: formData.province || null,
      phone: formData.phone || null,
      email: formData.email || null,
      ...(personType === 'business'
        ? { businessName: formData.businessName, firstName: null, lastName: null }
        : { firstName: formData.firstName, lastName: formData.lastName, businessName: null }),
    };
    const result = await create(payload);
    if (result.success) {
      reset();
      msg.success('Cliente agregado', 'create');
    } else if (!applyServerFieldErrors(result.error, setError, CREATE_FIELDS)) {
      msg.error(result.message, 'create');
    }
  };

  const startEdit = (customer) => {
    setEditingId(customer.id);
    msg.clear();
    editForm.reset({
      businessName: customer.businessName || '',
      firstName: customer.firstName || '',
      lastName: customer.lastName || '',
      fiscalCondition: customer.fiscalCondition || '',
      cuit: customer.cuit || '',
      address: customer.address || '',
      zipCode: customer.zipCode || '',
      city: customer.city || '',
      province: customer.province || '',
      phone: customer.phone || '',
      email: customer.email || '',
    });
  };

  const onUpdate = async (formData) => {
    const result = await update(editingId, {
      businessName: formData.businessName || null,
      firstName: formData.firstName || null,
      lastName: formData.lastName || null,
      fiscalCondition: formData.fiscalCondition,
      cuit: formData.cuit || null,
      address: formData.address || null,
      zipCode: formData.zipCode || null,
      city: formData.city || null,
      province: formData.province || null,
      phone: formData.phone || null,
      email: formData.email || null,
    });
    if (result.success) {
      const savedId = editingId;
      setEditingId(null);
      msg.success('Cambios guardados', savedId);
    } else if (!applyServerFieldErrors(result.error, editForm.setError, EDIT_FIELDS)) {
      msg.error(result.message, 'edit');
    }
  };

  const onDelete = async (id) => {
    if (!(await dialog.confirm({ message: '¿Eliminar este cliente?', confirmLabel: 'Eliminar', danger: true }))) return;
    const result = await remove(id);
    if (result.success) msg.success('Cliente eliminado', 'list');
    else msg.error(result.message, id);
  };

  const displayName = (c) =>
    c.businessName || [c.firstName, c.lastName].filter(Boolean).join(' ');

  const onExportData = async (customer) => {
    try {
      const response = await downloadCustomerData(customer.id);
      saveBlob(response.data, filenameFromResponse(response, 'cliente-datos.xlsx'));
      msg.success('Datos exportados: revisá tus descargas', customer.id);
    } catch (err) {
      msg.error(await errorMessageFrom(err), customer.id);
    }
  };

  const onAnonymize = async (customer) => {
    const message =
      `Se borrarán los datos personales de "${displayName(customer)}" ` +
      `(nombre, CUIT, dirección, teléfono y email). Sus remitos se conservan. ` +
      `Esta acción no se puede deshacer. ¿Continuar?`;
    if (!(await dialog.confirm({ title: 'Anonimizar cliente', message, confirmLabel: 'Anonimizar', danger: true }))) return;

    try {
      const { data } = await anonymizeCustomer(customer.id);
      await reload();
      msg.success(data.message || 'Cliente anonimizado', 'list');
    } catch (err) {
      msg.error(await errorMessageFrom(err), customer.id);
    }
  };

  const visibleCustomers = customers.filter((c) => c.id === editingId || matchesSearch(search, [
    c.businessName, c.firstName, c.lastName, c.cuit, c.city, c.province, c.fiscalCondition, c.phone, c.email,
  ]));

  if (loading) return <Spinner label="Cargando clientes..." />;

  return (
    <div className="customers-page">
      <h1>Clientes</h1>
      <FormMessage message={loadError ? { type: 'error', text: loadError } : null} />

      <form onSubmit={handleSubmit(onCreate)} className="customer-form">
        <div className="person-type-toggle">
          <label>
            <input type="radio" checked={personType === 'individual'} onChange={() => setPersonType('individual')} />
            Persona física
          </label>
          <label>
            <input type="radio" checked={personType === 'business'} onChange={() => setPersonType('business')} />
            Empresa
          </label>
        </div>

        {personType === 'business' ? (
          <div className="field">
            <label htmlFor="businessName">Razón social<RequiredMark /></label>
            <input
              id="businessName"
              placeholder="Ej: Distribuidora del Sur SA"
              {...register('businessName', { required: 'La razón social es obligatoria' })}
            />
            {errors.businessName && <span className="error">{errors.businessName.message}</span>}
          </div>
        ) : (
          <>
            <div className="field">
              <label htmlFor="firstName">Nombre<RequiredMark /></label>
              <input
                id="firstName"
                placeholder="Ej: Juan"
                {...register('firstName', { required: 'El nombre es obligatorio' })}
              />
              {errors.firstName && <span className="error">{errors.firstName.message}</span>}
            </div>
            <div className="field">
              <label htmlFor="lastName">Apellido</label>
              <input id="lastName" placeholder="Ej: Pérez" {...register('lastName')} />
            </div>
          </>
        )}

        <div className="field">
          <label htmlFor="fiscalCondition">Condición fiscal<RequiredMark /></label>
          <select id="fiscalCondition" {...register('fiscalCondition', { required: 'La condición fiscal es obligatoria' })}>
            <option value="">Elegí una opción...</option>
            {FISCAL_CONDITIONS.map((fc) => (
              <option key={fc} value={fc}>{fc}</option>
            ))}
          </select>
          {errors.fiscalCondition && <span className="error">{errors.fiscalCondition.message}</span>}
        </div>

        <div className="field">
          <label htmlFor="cuit">CUIT</label>
          <input id="cuit" placeholder="Ej: 20-12345678-6 (o DNI)" {...register('cuit', { validate: validateTaxId(null) })} />
          {errors.cuit && <span className="error">{errors.cuit.message}</span>}
        </div>
        <div className="field">
          <label htmlFor="address">Dirección</label>
          <input id="address" placeholder="Ej: San Martín 850" {...register('address')} />
        </div>
        <div className="field">
          <label htmlFor="zipCode">Código postal</label>
          <input id="zipCode" placeholder="Ej: 2300" {...register('zipCode')} />
        </div>
        <div className="field">
          <label htmlFor="city">Localidad</label>
          <input id="city" placeholder="Ej: Rafaela" {...register('city')} />
        </div>
        <div className="field">
          <label htmlFor="province">Provincia</label>
          <input id="province" placeholder="Ej: Santa Fe" {...register('province')} />
        </div>
        <div className="field">
          <label htmlFor="phone">Teléfono</label>
          <input id="phone" placeholder="Ej: 3492555111" {...register('phone')} />
        </div>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" type="email" placeholder="Ej: juan.perez@mail.com" {...register('email')} />
          {errors.email && <span className="error">{errors.email.message}</span>}
        </div>

        <button type="submit">Agregar cliente</button>
        <FormMessage message={msg.at('create')} onClose={msg.clear} />
        <RequiredLegend />
      </form>

      <SearchInput
        id="customer-search"
        label="Buscar clientes"
        placeholder="Buscar por nombre, razón social, CUIT, localidad..."
        value={search}
        onChange={setSearch}
      />

      <FormMessage message={msg.at('list')} />
      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Nombre / Razón social</th>
              <th>Condición fiscal</th>
              <th>CUIT</th>
              <th>Localidad</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {visibleCustomers.length === 0 && (
              <tr>
                <td colSpan={5} className="list-search-empty">
                  {search ? 'No hay clientes que coincidan con la búsqueda' : 'Todavía no hay clientes'}
                </td>
              </tr>
            )}
            {visibleCustomers.map((customer) => (
              <tr key={customer.id}>
                {editingId === customer.id ? (
                  <td colSpan={5} className="edit-cell">
                    <form onSubmit={editForm.handleSubmit(onUpdate)} className="inline-edit-form">
                      <div className="field">
                        <label htmlFor={`edit-businessName-${customer.id}`}>Razón social</label>
                        <input id={`edit-businessName-${customer.id}`} placeholder="Ej: Distribuidora del Sur SA" {...editForm.register('businessName')} />
                      </div>
                      <div className="field">
                        <label htmlFor={`edit-firstName-${customer.id}`}>Nombre</label>
                        <input id={`edit-firstName-${customer.id}`} placeholder="Ej: Juan" {...editForm.register('firstName')} />
                      </div>
                      <div className="field">
                        <label htmlFor={`edit-lastName-${customer.id}`}>Apellido</label>
                        <input id={`edit-lastName-${customer.id}`} placeholder="Ej: Pérez" {...editForm.register('lastName')} />
                      </div>
                      <div className="field">
                        <label htmlFor={`edit-fiscalCondition-${customer.id}`}>Condición fiscal<RequiredMark /></label>
                        <select id={`edit-fiscalCondition-${customer.id}`} {...editForm.register('fiscalCondition')}>
                          {FISCAL_CONDITIONS.map((fc) => (
                            <option key={fc} value={fc}>{fc}</option>
                          ))}
                        </select>
                      </div>
                      <div className="field">
                        <label htmlFor={`edit-cuit-${customer.id}`}>CUIT</label>
                        <input
                          id={`edit-cuit-${customer.id}`}
                          placeholder="Ej: 20-12345678-6 (o DNI)"
                          {...editForm.register('cuit', { validate: validateTaxId(customer.cuit) })}
                        />
                        {editErrors.cuit && <span className="error">{editErrors.cuit.message}</span>}
                      </div>
                      <div className="field">
                        <label htmlFor={`edit-address-${customer.id}`}>Dirección</label>
                        <input id={`edit-address-${customer.id}`} placeholder="Ej: San Martín 850" {...editForm.register('address')} />
                      </div>
                      <div className="field">
                        <label htmlFor={`edit-zipCode-${customer.id}`}>Código postal</label>
                        <input id={`edit-zipCode-${customer.id}`} placeholder="Ej: 2300" {...editForm.register('zipCode')} />
                      </div>
                      <div className="field">
                        <label htmlFor={`edit-city-${customer.id}`}>Localidad</label>
                        <input id={`edit-city-${customer.id}`} placeholder="Ej: Rafaela" {...editForm.register('city')} />
                      </div>
                      <div className="field">
                        <label htmlFor={`edit-province-${customer.id}`}>Provincia</label>
                        <input id={`edit-province-${customer.id}`} placeholder="Ej: Santa Fe" {...editForm.register('province')} />
                      </div>
                      <div className="field">
                        <label htmlFor={`edit-phone-${customer.id}`}>Teléfono</label>
                        <input id={`edit-phone-${customer.id}`} placeholder="Ej: 3492555111" {...editForm.register('phone')} />
                      </div>
                      <div className="field">
                        <label htmlFor={`edit-email-${customer.id}`}>Email</label>
                        <input id={`edit-email-${customer.id}`} type="email" placeholder="Ej: juan.perez@mail.com" {...editForm.register('email')} />
                        {editErrors.email && <span className="error">{editErrors.email.message}</span>}
                      </div>
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
                    <td data-label="Nombre / Razón social">
                      {displayName(customer)}
                      {customer.anonymizedAt && <span className="badge-cancelled">Anonimizado</span>}
                    </td>
                    <td data-label="Condición fiscal">{customer.fiscalCondition}</td>
                    <td data-label="CUIT">{customer.cuit || '—'}</td>
                    <td data-label="Localidad">{customer.city || '—'}</td>
                    <td data-label="Acciones">
                      {!customer.anonymizedAt && <button onClick={() => startEdit(customer)}>Editar</button>}
                      <button onClick={() => onDelete(customer.id)}>Eliminar</button>
                      {isAdmin && (
                        <>
                          <button onClick={() => onExportData(customer)}>Exportar datos</button>
                          {!customer.anonymizedAt && <button onClick={() => onAnonymize(customer)}>Anonimizar</button>}
                        </>
                      )}
                      <FormMessage message={msg.at(customer.id)} onClose={msg.clear} />
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

export default Customers;