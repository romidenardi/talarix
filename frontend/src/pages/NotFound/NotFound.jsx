import { Link } from 'react-router-dom';

const NotFound = () => (
  <div className="not-found-page">
    <h1>404</h1>
    <p>La página que buscás no existe.</p>
    <Link to="/">Volver a Inicio</Link>
  </div>
);

export default NotFound;
