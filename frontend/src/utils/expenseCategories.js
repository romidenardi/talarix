// Categorías de gasto de los servicios de una compra. Es copia de
// backend/src/utils/expenseCategories.js (lo que valida el servidor):
// test/unit/frontendParity.test.js revisa que sean las mismas.
export const EXPENSE_CATEGORIES = [
  { value: 'rent', label: 'Alquiler' },
  { value: 'utilities', label: 'Servicios (luz, gas, agua)' },
  { value: 'telecom', label: 'Internet y telefonía' },
  { value: 'shipping', label: 'Fletes y envíos' },
  { value: 'professional', label: 'Honorarios profesionales' },
  { value: 'maintenance', label: 'Mantenimiento y reparaciones' },
  { value: 'advertising', label: 'Publicidad y marketing' },
  { value: 'software', label: 'Software y suscripciones' },
  { value: 'insurance', label: 'Seguros' },
  { value: 'other', label: 'Otros' },
];

export const EXPENSE_CATEGORY_VALUES = EXPENSE_CATEGORIES.map((c) => c.value);

// Nombre para mostrar. Sin categoría (servicios cargados antes de que existieran): «Sin categoría».
export const expenseCategoryLabel = (value) =>
  EXPENSE_CATEGORIES.find((c) => c.value === value)?.label ?? 'Sin categoría';
