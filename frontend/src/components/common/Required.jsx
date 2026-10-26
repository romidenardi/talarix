// Marca de campo obligatorio (*) y leyenda al pie del formulario, en el color de alerta
export const RequiredMark = () => (
  <span className="required-mark" aria-hidden="true" style={{ color: 'var(--color-danger)' }}>
    {' '}
    *
  </span>
);

export const RequiredLegend = () => <p className="error required-legend">(*) Campo obligatorio</p>;
