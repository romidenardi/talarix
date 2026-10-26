import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

// Recuadros de confirmación propios, en lugar de confirm(), prompt() y alert() del navegador
// (se ven igual en todos los navegadores y en el celular no se bloquean).
//
//   const dialog = useDialog();
//   if (!(await dialog.confirm({ message: '¿Eliminar?', confirmLabel: 'Eliminar', danger: true }))) return;
//   const reason = await dialog.prompt({ message: 'Motivo (opcional):' });   // null si cancela
//   await dialog.alert({ message: 'Listo.' });
//
// Los tres aceptan también un texto solo: dialog.confirm('¿Cerrar sesión?').

const DialogContext = createContext(null);

export const useDialog = () => {
  const context = useContext(DialogContext);
  if (!context) throw new Error('useDialog tiene que usarse dentro de <DialogProvider>');
  return context;
};

const asOptions = (value) => (typeof value === 'string' ? { message: value } : value || {});

function DialogBox({ dialog, onClose }) {
  const [text, setText] = useState(dialog.defaultValue || '');
  const [error, setError] = useState('');
  const mainButton = useRef(null);
  const input = useRef(null);
  const isPrompt = dialog.kind === 'prompt';
  const isAlert = dialog.kind === 'alert';

  useEffect(() => {
    (isPrompt ? input.current : mainButton.current)?.focus();
  }, [isPrompt]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose(isAlert ? undefined : isPrompt ? null : false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, isAlert, isPrompt]);

  const accept = (e) => {
    e.preventDefault();
    if (isAlert) return onClose(undefined);
    if (!isPrompt) return onClose(true);
    const problem = dialog.validate ? dialog.validate(text) : null;
    if (problem) {
      setError(problem);
      return undefined;
    }
    return onClose(text);
  };

  return (
    <div className="dialog-overlay">
      <form
        className="dialog-box"
        role={isAlert ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-labelledby="dialog-title"
        onSubmit={accept}
      >
        <h3 id="dialog-title">{dialog.title || (isAlert ? 'Aviso' : 'Confirmar')}</h3>
        {dialog.message && <p className="dialog-message">{dialog.message}</p>}

        {isPrompt && (
          <div className="field">
            {dialog.label && <label htmlFor="dialog-input">{dialog.label}</label>}
            <input
              id="dialog-input"
              ref={input}
              value={text}
              placeholder={dialog.placeholder || ''}
              onChange={(e) => {
                setText(e.target.value);
                setError('');
              }}
              autoComplete="off"
            />
            {error && <span className="error">{error}</span>}
          </div>
        )}

        <div className="dialog-actions">
          {!isAlert && (
            <button type="button" onClick={() => onClose(isPrompt ? null : false)}>
              {dialog.cancelLabel || 'Cancelar'}
            </button>
          )}
          <button ref={mainButton} type="submit" className={dialog.danger ? 'btn-danger' : undefined}>
            {dialog.confirmLabel || (isAlert ? 'Entendido' : 'Aceptar')}
          </button>
        </div>
      </form>
    </div>
  );
}

export function DialogProvider({ children }) {
  // Un recuadro por vez: si se pide otro mientras hay uno abierto, espera su turno
  const [current, setCurrent] = useState(null);
  const currentRef = useRef(null);
  const queue = useRef([]);

  const open = useCallback((dialog) => {
    currentRef.current = dialog;
    setCurrent(dialog);
  }, []);

  const show = useCallback(
    (kind, options) =>
      new Promise((resolve) => {
        const dialog = { ...asOptions(options), kind, resolve, id: `${Date.now()}-${Math.random()}` };
        if (currentRef.current) queue.current.push(dialog);
        else open(dialog);
      }),
    [open],
  );

  const close = useCallback(
    (result) => {
      currentRef.current?.resolve(result);
      open(queue.current.shift() || null);
    },
    [open],
  );

  const api = useMemo(
    () => ({
      confirm: (options) => show('confirm', options),
      prompt: (options) => show('prompt', options),
      alert: (options) => show('alert', options),
    }),
    [show],
  );

  return (
    <DialogContext.Provider value={api}>
      {children}
      {current && <DialogBox key={current.id} dialog={current} onClose={close} />}
    </DialogContext.Provider>
  );
}
