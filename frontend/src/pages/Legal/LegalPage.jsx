import { Link } from 'react-router-dom';
import { LEGAL_VERSION, LEGAL_IS_DRAFT } from '../../legal/legalContent';

// Convierte **negrita** en <strong>
const renderInline = (text) =>
  text
    .split(/(\*\*[^*]+\*\*)/g)
    .map((part, i) =>
      part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part,
    );

export default function LegalPage({ doc }) {
  return (
    <div className="legal-page">
      <div className="legal-card">
        <nav className="legal-nav">
          <Link to="/terminos">Términos</Link>
          <Link to="/privacidad">Privacidad</Link>
          <Link to="/login">Ingresar</Link>
        </nav>

        {LEGAL_IS_DRAFT && <p className="legal-draft">Texto en revisión. Puede cambiar antes del lanzamiento.</p>}

        <h1>{doc.title}</h1>
        <p className="legal-version">Talarix · versión {LEGAL_VERSION}</p>
        <p>{renderInline(doc.intro)}</p>

        {doc.sections.map(([heading, body]) => (
          <section key={heading}>
            <h2>{heading}</h2>
            {body.split('\n\n').map((p, i) => (
              <p key={i}>{renderInline(p)}</p>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
