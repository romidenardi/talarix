import { useEffect, useState } from 'react';
import { useDialog } from '../../context/DialogContext.jsx';
import * as tablesApi from '../../api/tables.api.js';
import { getCategories } from '../../api/categories.api.js';
import FormMessage from '../../components/common/FormMessage.jsx';
import Spinner from '../../components/common/Spinner.jsx';
import SearchInput from '../../components/common/SearchInput.jsx';
import { useMessage } from '../../hooks/useMessage.js';
import { serverMessage } from '../../utils/serverErrors.js';
import { money } from '../../utils/reportFormat.js';
import { matchesSearch } from '../../utils/search.js';

const EMPTY_DISH = {
  internalCode: '',
  name: '',
  categoryId: '',
  price: '',
  promoPrice: '',
  extraIds: [],
  active: true,
};
const EMPTY_EXTRA = { name: '', price: '', active: true };

const dishPayload = (f) => ({
  internalCode: f.internalCode.trim(),
  name: f.name.trim(),
  categoryId: f.categoryId || null,
  price: f.price === '' ? '' : Number(f.price),
  promoPrice: String(f.promoPrice).trim() === '' ? null : Number(f.promoPrice),
  extraIds: f.extraIds,
  active: f.active,
});

const toDishForm = (d) => ({
  internalCode: d.internalCode || '',
  name: d.name,
  categoryId: d.categoryId || '',
  price: d.price,
  promoPrice: d.promoPrice ?? '',
  extraIds: d.extraIds || [],
  active: d.active,
});

// Campos de un plato: se usan para el alta y para editar
function DishFields({ idPrefix, form, setForm, categories, extras, showStatus }) {
  const toggle = (id) =>
    setForm({
      ...form,
      extraIds: form.extraIds.includes(id) ? form.extraIds.filter((x) => x !== id) : [...form.extraIds, id],
    });
  const field = (name) => ({
    id: `${idPrefix}-${name}`,
    value: form[name],
    onChange: (e) => setForm({ ...form, [name]: e.target.value }),
  });
  return (
    <>
      <div className="field">
        <label htmlFor={`${idPrefix}-internalCode`}>Código</label>
        <input maxLength={50} placeholder="Ej: RAV" {...field('internalCode')} />
      </div>
      <div className="field">
        <label htmlFor={`${idPrefix}-name`}>Plato</label>
        <input maxLength={255} placeholder="Ej: Ravioles" {...field('name')} />
      </div>
      <div className="field">
        <label htmlFor={`${idPrefix}-categoryId`}>Categoría</label>
        <select {...field('categoryId')}>
          <option value="">Sin categoría</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor={`${idPrefix}-price`}>Precio de lista</label>
        <input type="number" min="0" step="0.01" {...field('price')} />
      </div>
      <div className="field">
        <label htmlFor={`${idPrefix}-promoPrice`}>Precio promo (opcional)</label>
        <input type="number" min="0" step="0.01" {...field('promoPrice')} />
      </div>
      {showStatus && (
        <div className="field">
          <label htmlFor={`${idPrefix}-active`}>Estado</label>
          <select
            id={`${idPrefix}-active`}
            value={String(form.active)}
            onChange={(e) => setForm({ ...form, active: e.target.value === 'true' })}
          >
            <option value="true">Disponible</option>
            <option value="false">No disponible</option>
          </select>
        </div>
      )}
      {extras.length > 0 && (
        <fieldset className="tab-extras menu-extras-pick">
          <legend>Adicionales que se pueden pedir con este plato</legend>
          {extras.map((x) => (
            <label key={x.id} htmlFor={`${idPrefix}-extra-${x.id}`}>
              <input
                id={`${idPrefix}-extra-${x.id}`}
                type="checkbox"
                checked={form.extraIds.includes(x.id)}
                onChange={() => toggle(x.id)}
              />{' '}
              {x.name} <small>+{money(x.price)}</small>
              {x.active === false && <small> (no disponible)</small>}
            </label>
          ))}
        </fieldset>
      )}
    </>
  );
}

// El menú de las mesas (administrador y editor): platos con su precio y los adicionales que se
// pueden sumar. Los platos no llevan stock; los productos siguen sirviendo para los insumos.
export default function MenuSettings() {
  const dialog = useDialog();
  const msg = useMessage();
  const [menu, setMenu] = useState({ dishes: [], extras: [] });
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dishForm, setDishForm] = useState(EMPTY_DISH);
  const [extraForm, setExtraForm] = useState(EMPTY_EXTRA);
  const [editingDish, setEditingDish] = useState(null);
  const [editingExtra, setEditingExtra] = useState(null);
  const [search, setSearch] = useState('');

  const load = async () => {
    try {
      const { data } = await tablesApi.getMenu();
      setMenu(data);
    } catch (err) {
      msg.error(serverMessage(err, 'No se pudo cargar el menú'), 'list');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    getCategories()
      .then(({ data }) => setCategories(data.flatMap((c) => [c, ...(c.subcategories || [])])))
      .catch(() => setCategories([]));
  }, []);

  const categoryName = (id) => categories.find((c) => c.id === id)?.name || '';
  const extraName = (id) => menu.extras.find((x) => x.id === id)?.name;

  // ---- Platos ----

  const createDish = async (e) => {
    e.preventDefault();
    if (!dishForm.internalCode.trim()) return msg.error('Escribí el código del plato', 'dish');
    if (!dishForm.name.trim()) return msg.error('Escribí el nombre del plato', 'dish');
    if (dishForm.price === '') return msg.error('Escribí el precio', 'dish');
    try {
      await tablesApi.createDish(dishPayload(dishForm));
      setDishForm({ ...EMPTY_DISH, categoryId: dishForm.categoryId });
      await load();
      msg.success('Plato agregado', 'dish');
    } catch (err) {
      msg.error(serverMessage(err, 'No se pudo agregar el plato'), 'dish');
    }
    return undefined;
  };

  const saveDish = async (e) => {
    e.preventDefault();
    const { id } = editingDish;
    try {
      await tablesApi.updateDish(id, dishPayload(editingDish));
      setEditingDish(null);
      await load();
      msg.success('Cambios guardados', id);
    } catch (err) {
      msg.error(serverMessage(err, 'No se pudo guardar el plato'), id);
    }
  };

  const removeDish = async (dish) => {
    const ok = await dialog.confirm({
      message: `¿Eliminar el plato ${dish.name}?`,
      confirmLabel: 'Eliminar',
      danger: true,
    });
    if (!ok) return;
    try {
      await tablesApi.deleteDish(dish.id);
      await load();
    } catch (err) {
      msg.error(serverMessage(err, 'No se pudo eliminar el plato'), dish.id);
    }
  };

  // ---- Adicionales ----

  const createExtra = async (e) => {
    e.preventDefault();
    if (!extraForm.name.trim()) return msg.error('Escribí el nombre del adicional', 'extra');
    if (extraForm.price === '') return msg.error('Escribí el precio (puede ser 0)', 'extra');
    try {
      await tablesApi.createExtra({ name: extraForm.name.trim(), price: Number(extraForm.price) });
      setExtraForm(EMPTY_EXTRA);
      await load();
      msg.success('Adicional agregado. Asignalo a los platos que lo lleven.', 'extra');
    } catch (err) {
      msg.error(serverMessage(err, 'No se pudo agregar el adicional'), 'extra');
    }
    return undefined;
  };

  const saveExtra = async (e) => {
    e.preventDefault();
    const { id } = editingExtra;
    try {
      await tablesApi.updateExtra(id, {
        name: editingExtra.name.trim(),
        price: editingExtra.price === '' ? '' : Number(editingExtra.price),
        active: editingExtra.active,
      });
      setEditingExtra(null);
      await load();
      msg.success('Cambios guardados', id);
    } catch (err) {
      msg.error(serverMessage(err, 'No se pudo guardar el adicional'), id);
    }
  };

  const removeExtra = async (extra) => {
    const ok = await dialog.confirm({
      message: `¿Eliminar el adicional ${extra.name}? Se quita de todos los platos.`,
      confirmLabel: 'Eliminar',
      danger: true,
    });
    if (!ok) return;
    try {
      await tablesApi.deleteExtra(extra.id);
      await load();
    } catch (err) {
      msg.error(serverMessage(err, 'No se pudo eliminar el adicional'), extra.id);
    }
  };

  if (loading) return <Spinner label="Cargando menú..." />;

  const dishes = [...menu.dishes]
    .filter((d) => matchesSearch(search, [d.name, d.internalCode, categoryName(d.categoryId)]))
    .sort(
      (a, b) =>
        (categoryName(a.categoryId) || '~').localeCompare(categoryName(b.categoryId) || '~') ||
        a.name.localeCompare(b.name),
    );

  return (
    <div className="menu-settings">
      <p className="report-note">
        En la mesa se piden los platos de este menú. No llevan stock: si querés controlar insumos, seguí usando
        Productos.
      </p>

      <h2>Platos</h2>
      <form className="inline-edit-form" onSubmit={createDish}>
        <DishFields
          idPrefix="dish-new"
          form={dishForm}
          setForm={setDishForm}
          categories={categories}
          extras={menu.extras}
        />
        <div className="inline-edit-actions">
          <button type="submit">Agregar plato</button>
        </div>
        <FormMessage message={msg.at('dish')} onClose={msg.clear} />
      </form>

      <FormMessage message={msg.at('list')} onClose={msg.clear} />
      {menu.dishes.length > 0 && (
        <SearchInput
          id="menu-search"
          label="Buscar plato"
          placeholder="Buscar por plato, código o categoría..."
          value={search}
          onChange={setSearch}
        />
      )}
      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Código</th>
              <th>Plato</th>
              <th>Categoría</th>
              <th>Precio</th>
              <th>Promo</th>
              <th>Adicionales</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {dishes.length === 0 && (
              <tr>
                <td colSpan={8} className="list-search-empty">
                  {menu.dishes.length ? 'Ningún plato coincide con la búsqueda' : 'Todavía no hay platos'}
                </td>
              </tr>
            )}
            {dishes.map((dish) =>
              editingDish?.id === dish.id ? (
                <tr key={dish.id}>
                  <td colSpan={8} className="edit-cell">
                    <form className="inline-edit-form" onSubmit={saveDish}>
                      <DishFields
                        idPrefix={`dish-${dish.id}`}
                        form={editingDish}
                        setForm={(f) => setEditingDish({ ...f, id: dish.id })}
                        categories={categories}
                        extras={menu.extras}
                        showStatus
                      />
                      <div className="inline-edit-actions">
                        <button type="submit">Guardar</button>
                        <button type="button" onClick={() => setEditingDish(null)}>
                          Cancelar
                        </button>
                      </div>
                      <FormMessage message={msg.at(dish.id)} onClose={msg.clear} />
                    </form>
                  </td>
                </tr>
              ) : (
                <tr key={dish.id}>
                  <td data-label="Código">{dish.internalCode}</td>
                  <td data-label="Plato">{dish.name}</td>
                  <td data-label="Categoría">{categoryName(dish.categoryId) || '—'}</td>
                  <td data-label="Precio">{money(dish.price)}</td>
                  <td data-label="Promo">{dish.promoPrice != null ? money(dish.promoPrice) : '—'}</td>
                  <td data-label="Adicionales">{dish.extraIds.map(extraName).filter(Boolean).join(', ') || '—'}</td>
                  <td data-label="Estado">{dish.active ? 'Disponible' : 'No disponible'}</td>
                  <td data-label="Acciones">
                    <button type="button" onClick={() => setEditingDish({ ...toDishForm(dish), id: dish.id })}>
                      Editar
                    </button>
                    <button type="button" onClick={() => removeDish(dish)}>
                      Eliminar
                    </button>
                    <FormMessage message={msg.at(dish.id)} onClose={msg.clear} />
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>

      <h2>Adicionales</h2>
      <p className="report-note">
        Se cargan una vez y se asignan a los platos (al agregar o editar el plato). En la mesa se eligen los que quiera
        cada uno.
      </p>
      <form className="inline-edit-form" onSubmit={createExtra}>
        <div className="field">
          <label htmlFor="extra-name">Adicional</label>
          <input
            id="extra-name"
            maxLength={255}
            placeholder="Ej: Salsa rosa"
            value={extraForm.name}
            onChange={(e) => setExtraForm({ ...extraForm, name: e.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="extra-price">Precio</label>
          <input
            id="extra-price"
            type="number"
            min="0"
            step="0.01"
            value={extraForm.price}
            onChange={(e) => setExtraForm({ ...extraForm, price: e.target.value })}
          />
        </div>
        <div className="inline-edit-actions">
          <button type="submit">Agregar adicional</button>
        </div>
        <FormMessage message={msg.at('extra')} onClose={msg.clear} />
      </form>

      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Adicional</th>
              <th>Precio</th>
              <th>Platos</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {menu.extras.length === 0 && (
              <tr>
                <td colSpan={5} className="list-search-empty">
                  Todavía no hay adicionales
                </td>
              </tr>
            )}
            {menu.extras.map((extra) =>
              editingExtra?.id === extra.id ? (
                <tr key={extra.id}>
                  <td colSpan={5} className="edit-cell">
                    <form className="inline-edit-form" onSubmit={saveExtra}>
                      <div className="field">
                        <label htmlFor={`extra-${extra.id}-name`}>Adicional</label>
                        <input
                          id={`extra-${extra.id}-name`}
                          maxLength={255}
                          value={editingExtra.name}
                          onChange={(e) => setEditingExtra({ ...editingExtra, name: e.target.value })}
                        />
                      </div>
                      <div className="field">
                        <label htmlFor={`extra-${extra.id}-price`}>Precio</label>
                        <input
                          id={`extra-${extra.id}-price`}
                          type="number"
                          min="0"
                          step="0.01"
                          value={editingExtra.price}
                          onChange={(e) => setEditingExtra({ ...editingExtra, price: e.target.value })}
                        />
                      </div>
                      <div className="field">
                        <label htmlFor={`extra-${extra.id}-active`}>Estado</label>
                        <select
                          id={`extra-${extra.id}-active`}
                          value={String(editingExtra.active)}
                          onChange={(e) => setEditingExtra({ ...editingExtra, active: e.target.value === 'true' })}
                        >
                          <option value="true">Disponible</option>
                          <option value="false">No disponible</option>
                        </select>
                      </div>
                      <div className="inline-edit-actions">
                        <button type="submit">Guardar</button>
                        <button type="button" onClick={() => setEditingExtra(null)}>
                          Cancelar
                        </button>
                      </div>
                      <FormMessage message={msg.at(extra.id)} onClose={msg.clear} />
                    </form>
                  </td>
                </tr>
              ) : (
                <tr key={extra.id}>
                  <td data-label="Adicional">{extra.name}</td>
                  <td data-label="Precio">{money(extra.price)}</td>
                  <td data-label="Platos">{menu.dishes.filter((d) => d.extraIds.includes(extra.id)).length || '—'}</td>
                  <td data-label="Estado">{extra.active ? 'Disponible' : 'No disponible'}</td>
                  <td data-label="Acciones">
                    <button
                      type="button"
                      onClick={() =>
                        setEditingExtra({ id: extra.id, name: extra.name, price: extra.price, active: extra.active })
                      }
                    >
                      Editar
                    </button>
                    <button type="button" onClick={() => removeExtra(extra)}>
                      Eliminar
                    </button>
                    <FormMessage message={msg.at(extra.id)} onClose={msg.clear} />
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
