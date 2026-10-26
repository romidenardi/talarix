const Spinner = ({ label = 'Cargando...' }) => (
  <div className="spinner-wrapper">
    <div className="spinner" />
    <span>{label}</span>
  </div>
);

export default Spinner;
