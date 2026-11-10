// Opciones del selector de categoría de un producto, combo o plato. Un rubro con subcategorías va
// como título de su grupo y no se puede elegir: el producto va en una de sus subcategorías. Las
// categorías sin subcategorías se eligen normalmente.
// categories: todas las categorías del comercio (con parentId), en cualquier orden y aunque se repitan.
// current: la categoría que ya tiene el producto. Si es un rubro con subcategorías (de antes de esta
// regla), se muestra deshabilitada para que se vea y se pueda cambiar.
export default function CategoryOptions({ categories, current = '' }) {
  const unique = [...new Map(categories.map((c) => [c.id, c])).values()];
  const byName = (a, b) => a.name.localeCompare(b.name, 'es');
  const childrenOf = (id) => unique.filter((c) => c.parentId === id).sort(byName);
  const topLevel = unique.filter((c) => !c.parentId).sort(byName);
  const currentParent = topLevel.find((c) => c.id === current && childrenOf(c.id).length > 0);

  return (
    <>
      <option value="">Sin categoría</option>
      {currentParent && (
        <option value={currentParent.id} disabled>
          {currentParent.name} (elegí una subcategoría)
        </option>
      )}
      {topLevel.map((category) => {
        const children = childrenOf(category.id);
        if (!children.length) {
          return (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          );
        }
        return (
          <optgroup key={category.id} label={category.name}>
            {children.map((child) => (
              <option key={child.id} value={child.id}>
                {child.name}
              </option>
            ))}
          </optgroup>
        );
      })}
    </>
  );
}
