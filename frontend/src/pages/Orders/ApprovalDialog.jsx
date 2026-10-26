import { useEffect, useState } from 'react';

// Pedido de autorización para el operador: un administrador o editor escribe su email y contraseña
// en la misma pantalla para aprobar un descuento o un precio distinto al de lista.
// summary: { discountPercent, discountAmount, prices: [{ name, unitPrice, listPrice, perKg }] }
const money = (n) => `$${Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function ApprovalDialog({ summary, notice, onApprove, onCancel }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && !sending) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, sending]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError('Completá el email y la contraseña de quien autoriza');
      return;
    }
    setError('');
    setSending(true);
    try {
      await onApprove(email.trim(), password);
    } catch (err) {
      setError(err.response?.data?.message || 'No se pudo autorizar. Probá de nuevo.');
      setPassword('');
      setSending(false);
    }
  };

  return (
    <div className="scanner-overlay">
      <form
        className="scanner-modal approval-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="approval-title"
        onSubmit={handleSubmit}
      >
        <h3 id="approval-title">Autorización necesaria</h3>
        <p>
          {notice || 'Este remito tiene un descuento o un precio distinto al de lista.'} Un{' '}
          <strong>administrador o editor</strong> tiene que autorizarlo con su email y contraseña.
        </p>

        <ul className="approval-summary">
          {summary.discountPercent > 0 && <li>Descuento: {summary.discountPercent}%</li>}
          {summary.discountAmount > 0 && <li>Descuento por monto: {money(summary.discountAmount)}</li>}
          {summary.prices.map((p) => (
            <li key={`${p.name}-${p.unitPrice}`}>
              {p.name}: {money(p.unitPrice)}
              {p.perKg ? ' por kg' : ''} <span className="approval-list-price">(lista {money(p.listPrice)})</span>
            </li>
          ))}
        </ul>

        <div className="field">
          <label htmlFor="approval-email">Email de quien autoriza</label>
          <input
            id="approval-email"
            type="email"
            autoComplete="off"
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="approval-password">Contraseña</label>
          <input
            id="approval-password"
            type="password"
            autoComplete="off"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <div className="approval-actions">
          <button type="submit" disabled={sending}>
            {sending ? 'Autorizando…' : 'Autorizar y generar remito'}
          </button>
          <button type="button" onClick={onCancel} disabled={sending}>
            Volver al remito
          </button>
        </div>
      </form>
    </div>
  );
}
