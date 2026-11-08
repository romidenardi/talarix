import { Link } from 'react-router-dom';

// Casilla de aceptación de los textos legales: al activar la cuenta y cuando se publica una versión
// nueva. El texto tiene que coincidir con la cláusula 17 de los Términos.
export default function TermsCheckbox({ checked, onChange }) {
  return (
    <label className="terms-check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        Leí y acepto los{' '}
        <Link to="/terminos" target="_blank" rel="noopener noreferrer">
          Términos y Condiciones
        </Link>{' '}
        y la{' '}
        <Link to="/privacidad" target="_blank" rel="noopener noreferrer">
          Política de Privacidad
        </Link>
        , y presto mi consentimiento expreso para que mis datos se almacenen en servidores ubicados fuera de Argentina
        (cláusula 4 de la Política de Privacidad).
      </span>
    </label>
  );
}
