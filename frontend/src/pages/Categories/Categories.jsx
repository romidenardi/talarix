import { useState, Fragment } from 'react';
import { useDialog } from '../../context/DialogContext.jsx';
import { useForm } from 'react-hook-form';
import { useResource } from '../../hooks/useResource.js';
import * as categoriesApi from '../../api/categories.api.js';
import Spinner from '../../components/common/Spinner.jsx';
import { RequiredMark, RequiredLegend } from '../../components/common/Required.jsx';
import FormMessage from '../../components/common/FormMessage.jsx';
import { useMessage } from '../../hooks/useMessage.js';
import { applyServerFieldErrors } from '../../utils/serverErrors.js';

const api = {
  getAll: categoriesApi.getCategories,
  create: categoriesApi.createCategory,
  update: categoriesApi.updateCategory,
  remove: categoriesApi.deleteCategory,
};

const Categories = () => {
  const {
    items: categories,
    loading,
    loadError,
    create,
    update,
    remove,
  } = useResource(api, { reloadAfterChange: true });
  const msg = useMessage();
  const dialog = useDialog();
  const [editingId, setEditingId] = useState(null);

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm();
  const editForm = useForm();
  const { errors: editErrors } = editForm.formState;

  const topLevelCategories = categories.filter((c) => !c.parentId);

  const onCreate = async (formData) => {
    const result = await create({
      name: formData.name,
      parentId: formData.parentId || null,
    });
    if (result.success) {
      reset();
      msg.success('Categoría creada', 'create');
    } else if (!applyServerFieldErrors(result.error, setError, ['name'])) {
      msg.error(result.message, 'create');
    }
  };

  const startEdit = (category) => {
    setEditingId(category.id);
    msg.clear();
    editForm.reset({ name: category.name, parentId: category.parentId || '' });
  };

  const onUpdate = async (formData) => {
    const result = await update(editingId, {
      name: formData.name,
      parentId: formData.parentId || null,
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
    if (!(await dialog.confirm({ message: '¿Eliminar esta categoría?', confirmLabel: 'Eliminar', danger: true })))
      return;
    const result = await remove(id);
    if (result.success) msg.success('Categoría eliminada', 'list');
    else msg.error(result.message, id);
  };

  if (loading) return <Spinner label="Cargando categorías..." />;

  return (
    <div className="categories-page">
      <h1>Categorías</h1>
      <FormMessage message={loadError ? { type: 'error', text: loadError } : null} />

      <form onSubmit={handleSubmit(onCreate)} className="category-form">
        <div className="field">
          <label htmlFor="name">
            Nombre
            <RequiredMark />
          </label>
          <input id="name" placeholder="Ej: Bebidas" {...register('name', { required: 'El nombre es obligatorio' })} />
          {errors.name && <span className="error">{errors.name.message}</span>}
        </div>

        <div className="field">
          <label htmlFor="parentId">Categoría padre (opcional)</label>
          <select id="parentId" {...register('parentId')}>
            <option value="">Sin categoría padre</option>
            {topLevelCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <button type="submit">Agregar categoría</button>
        <FormMessage message={msg.at('create')} onClose={msg.clear} />
        <RequiredLegend />
      </form>

      <FormMessage message={msg.at('list')} />
      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {topLevelCategories.map((category) => (
              <Fragment key={category.id}>
                <tr>
                  {editingId === category.id ? (
                    <td className="edit-cell">
                      <form onSubmit={editForm.handleSubmit(onUpdate)} className="inline-edit-form">
                        <div className="field">
                          <label htmlFor={`edit-name-${category.id}`}>
                            Nombre
                            <RequiredMark />
                          </label>
                          <input
                            id={`edit-name-${category.id}`}
                            {...editForm.register('name', { required: 'El nombre es obligatorio' })}
                          />
                          {editErrors.name && <span className="error">{editErrors.name.message}</span>}
                        </div>
                        <div className="field">
                          <label htmlFor={`edit-parent-${category.id}`}>Categoría padre</label>
                          <select id={`edit-parent-${category.id}`} {...editForm.register('parentId')}>
                            <option value="">Sin categoría padre</option>
                            {topLevelCategories
                              .filter((c) => c.id !== category.id)
                              .map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.name}
                                </option>
                              ))}
                          </select>
                        </div>
                        <div className="inline-edit-actions">
                          <button type="submit">Guardar</button>
                          <button type="button" onClick={() => setEditingId(null)}>
                            Cancelar
                          </button>
                        </div>
                        <FormMessage message={msg.at('edit')} onClose={msg.clear} />
                        <RequiredLegend />
                      </form>
                    </td>
                  ) : (
                    <td data-label="Nombre">{category.name}</td>
                  )}
                  <td data-label="Acciones">
                    {editingId !== category.id && (
                      <>
                        <button onClick={() => startEdit(category)}>Editar</button>
                        <button onClick={() => onDelete(category.id)}>Eliminar</button>
                      </>
                    )}
                    <FormMessage message={msg.at(category.id)} onClose={msg.clear} />
                  </td>
                </tr>
                {category.subcategories?.map((sub) => (
                  <tr key={sub.id} className="subcategory-row">
                    {editingId === sub.id ? (
                      <td className="edit-cell">
                        <form onSubmit={editForm.handleSubmit(onUpdate)} className="inline-edit-form">
                          <div className="field">
                            <label htmlFor={`edit-name-${sub.id}`}>
                              Nombre
                              <RequiredMark />
                            </label>
                            <input
                              id={`edit-name-${sub.id}`}
                              {...editForm.register('name', { required: 'El nombre es obligatorio' })}
                            />
                            {editErrors.name && <span className="error">{editErrors.name.message}</span>}
                          </div>
                          <div className="field">
                            <label htmlFor={`edit-parent-${sub.id}`}>Categoría padre</label>
                            <select id={`edit-parent-${sub.id}`} {...editForm.register('parentId')}>
                              <option value="">Sin categoría padre</option>
                              {topLevelCategories.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.name}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="inline-edit-actions">
                            <button type="submit">Guardar</button>
                            <button type="button" onClick={() => setEditingId(null)}>
                              Cancelar
                            </button>
                          </div>
                          <FormMessage message={msg.at('edit')} onClose={msg.clear} />
                          <RequiredLegend />
                        </form>
                      </td>
                    ) : (
                      <td data-label="Nombre">
                        <span className="subcategory-name">↳ {sub.name}</span>
                      </td>
                    )}
                    <td data-label="Acciones">
                      {editingId !== sub.id && (
                        <>
                          <button onClick={() => startEdit(sub)}>Editar</button>
                          <button onClick={() => onDelete(sub.id)}>Eliminar</button>
                        </>
                      )}
                      <FormMessage message={msg.at(sub.id)} onClose={msg.clear} />
                    </td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default Categories;
