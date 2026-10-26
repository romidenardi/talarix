import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './SearchSelect.css';

const MAX_RESULTS = 100;

const normalize = (text) =>
  String(text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

const SearchSelect = ({
  id,
  title = 'Buscar',
  value,
  onChange,
  options,
  extraOptions = [],
  placeholder = 'Elegí una opción...',
  searchPlaceholder = 'Escribí para buscar...',
  emptyText = 'No hay resultados',
  hasError = false,
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const triggerRef = useRef(null);
  const listRef = useRef(null);

  const prepared = useMemo(
    () =>
      options.map((option) => ({
        ...option,
        haystack: normalize([option.label, option.detail, ...(option.keywords || [])].filter(Boolean).join(' ')),
      })),
    [options],
  );

  const words = normalize(query).split(/\s+/).filter(Boolean);
  const matches = words.length
    ? prepared.filter((option) => words.every((word) => option.haystack.includes(word)))
    : prepared;
  const shown = matches.slice(0, MAX_RESULTS);

  const selected = [...options, ...extraOptions].find((option) => option.value === value);

  // Mientras la ventana está abierta, la página de atrás no se desplaza
  useEffect(() => {
    if (!open) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  // Mantiene visible la opción marcada al moverse con las flechas
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const openPicker = () => {
    setQuery('');
    setActive(0);
    setOpen(true);
  };

  const close = () => {
    setOpen(false);
    setQuery('');
    triggerRef.current?.focus();
  };

  const choose = (nextValue) => {
    onChange(nextValue);
    close();
  };

  const handleKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((current) => Math.min(current + 1, shown.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((current) => Math.max(current - 1, 0));
    } else if (event.key === 'Enter') {
      // Los lectores de códigos de barras terminan con Enter: elige el primer resultado
      event.preventDefault();
      if (shown[active]) choose(shown[active].value);
    }
  };

  return (
    <>
      <button
        type="button"
        id={id}
        ref={triggerRef}
        className={`search-select-trigger${hasError ? ' has-error' : ''}`}
        aria-haspopup="dialog"
        onClick={openPicker}
      >
        <span className={selected ? 'search-select-value' : 'search-select-placeholder'}>
          {selected ? selected.label : placeholder}
        </span>
        <span className="search-select-icon" aria-hidden="true">
          Buscar
        </span>
      </button>

      {open &&
        createPortal(
          <div
            className="search-select-overlay"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) close();
            }}
          >
            <div
              className="search-select-modal"
              role="dialog"
              aria-modal="true"
              aria-label={title}
              onKeyDown={handleKeyDown}
            >
              <div className="search-select-head">
                <h3>{title}</h3>
                <button type="button" className="search-select-close" aria-label="Cerrar" onClick={close}>
                  ×
                </button>
              </div>

              <input
                type="search"
                autoFocus
                autoComplete="off"
                placeholder={searchPlaceholder}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActive(0);
                }}
              />

              <ul className="search-select-list" role="listbox" ref={listRef}>
                {shown.map((option, index) => (
                  <li
                    key={option.value}
                    role="option"
                    aria-selected={option.value === value}
                    data-active={index === active}
                    className={`search-select-option${option.value === value ? ' is-selected' : ''}`}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => choose(option.value)}
                  >
                    <span className="search-select-option-label">{option.label}</span>
                    {option.detail && <span className="search-select-option-detail">{option.detail}</span>}
                  </li>
                ))}
                {shown.length === 0 && <li className="search-select-empty">{emptyText}</li>}
                {matches.length > MAX_RESULTS && (
                  <li className="search-select-more">
                    Mostrando los primeros {MAX_RESULTS} de {matches.length}. Escribí más para afinar la búsqueda.
                  </li>
                )}
              </ul>

              {extraOptions.length > 0 && (
                <div className="search-select-extras">
                  {extraOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className="search-select-extra"
                      onClick={() => choose(option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
};

export default SearchSelect;
