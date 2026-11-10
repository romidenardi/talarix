import { useEffect, useState } from 'react';
import { useDialog } from '../../context/DialogContext.jsx';
import { Outlet, NavLink, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import logo from '../../assets/logo.png';
import { getTablesSettings } from '../../api/tables.api.js';
import TermsGate from '../legal/TermsGate.jsx';

const ROLE_LABELS = {
  admin: 'Administrador',
  editor: 'Editor',
  operador: 'Operador',
  mozo: 'Mozo',
};

const Layout = () => {
  const { logout, role, user, isDemo, isClosing, tablesEnabled, setTablesEnabled } = useAuth();
  const dialog = useDialog();
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  // El superadmin puede activar o quitar el módulo de mesas en cualquier momento: se revisa al entrar
  useEffect(() => {
    if (isClosing) return;
    getTablesSettings()
      .then(({ data }) => setTablesEnabled(Boolean(data.enabled)))
      .catch(() => {});
  }, [isClosing]);

  // Cierra el menú al navegar a otra pantalla
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  // Con el menú abierto: Escape lo cierra, no se scrollea el fondo y,
  // si la ventana pasa a tamaño escritorio, se cierra solo
  useEffect(() => {
    if (!menuOpen) return undefined;

    const onKey = (e) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    const desktop = window.matchMedia('(min-width: 861px)');
    const onChange = (e) => {
      if (e.matches) setMenuOpen(false);
    };

    window.addEventListener('keydown', onKey);
    desktop.addEventListener('change', onChange);
    document.body.style.overflow = 'hidden';

    return () => {
      window.removeEventListener('keydown', onKey);
      desktop.removeEventListener('change', onChange);
      document.body.style.overflow = '';
    };
  }, [menuOpen]);

  const handleLogout = async () => {
    if (await dialog.confirm({ message: '¿Cerrar sesión?', confirmLabel: 'Cerrar sesión' })) {
      logout();
    }
  };

  // Comercio con baja pendiente: la única pantalla disponible es la exportación de datos
  if (isClosing && location.pathname !== '/exportar') {
    return <Navigate to="/exportar" replace />;
  }

  // El mozo solo usa Mesas
  const isWaiter = role === 'mozo';
  if (isWaiter && !location.pathname.startsWith('/mesas')) {
    return <Navigate to="/mesas" replace />;
  }

  const canManageData = role === 'admin' || role === 'editor';
  const isAdmin = role === 'admin';

  // Menú agrupado por secciones: cada una muestra solo lo que el rol puede usar, y si no queda
  // nada (por ejemplo, Gastronomía sin el módulo de mesas) no aparece
  const sections = [
    {
      title: 'Mi comercio',
      links: [
        canManageData && ['/products', 'Productos'],
        canManageData && ['/categories', 'Categorías'],
        canManageData && ['/payments', 'Formas de pago'],
      ],
    },
    { title: 'Gastronomía', links: [tablesEnabled && ['/mesas', 'Mesas']] },
    {
      title: 'Ventas',
      links: [canManageData && ['/customers', 'Clientes'], ['/orders', 'Remitos']],
    },
    {
      title: 'Compras',
      links: [canManageData && ['/suppliers', 'Proveedores'], ['/purchases', 'Compras']],
    },
    {
      title: 'Utilidades',
      links: [
        isAdmin && !isDemo && ['/users', 'Usuarios'],
        canManageData && !isDemo && ['/imports', 'Importar'],
        isAdmin && !isDemo && ['/exportar', 'Exportar'],
      ],
    },
  ].map((section) => ({ ...section, links: section.links.filter(Boolean) }));

  // Con una versión nueva de los textos legales, primero hay que aceptarla (salvo durante la baja,
  // que solo deja exportar)
  return (
    <TermsGate skip={isClosing}>
      <div className="app-layout">
        <header className="mobile-topbar">
          <button
            type="button"
            className="menu-toggle"
            aria-label={menuOpen ? 'Cerrar menú' : 'Abrir menú'}
            aria-expanded={menuOpen}
            aria-controls="main-sidebar"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span />
            <span />
            <span />
          </button>
          <img src={logo} alt="Talarix" className="sidebar-logo" />
        </header>

        {menuOpen && <div className="sidebar-overlay" onClick={() => setMenuOpen(false)} />}

        <aside id="main-sidebar" className={`sidebar${menuOpen ? ' open' : ''}`}>
          <div className="sidebar-brand">
            <img src={logo} alt="Talarix" className="sidebar-logo" />
          </div>

          {user && (
            <div className="sidebar-user">
              <span className="sidebar-user-name">{user.name}</span>
              <span className="sidebar-user-role">{ROLE_LABELS[role] || role}</span>
            </div>
          )}

          <nav className="sidebar-nav">
            {isClosing ? (
              <NavLink to="/exportar">Exportar mis datos</NavLink>
            ) : isWaiter ? (
              <NavLink to="/mesas">Mesas</NavLink>
            ) : (
              <>
                <NavLink to="/" end>
                  Inicio
                </NavLink>
                {canManageData && <NavLink to="/reports">Reportes</NavLink>}
                {sections.map(
                  (section) =>
                    section.links.length > 0 && (
                      <div key={section.title} className="sidebar-section">
                        <span className="sidebar-section-title">{section.title}</span>
                        {section.links.map(([to, label]) => (
                          <NavLink key={to} to={to}>
                            {label}
                          </NavLink>
                        ))}
                      </div>
                    ),
                )}
              </>
            )}
          </nav>
          <button className="sidebar-logout" onClick={handleLogout}>
            Cerrar sesión
          </button>
        </aside>
        <main className="app-main">
          {isDemo && (
            <div className="demo-banner" role="status">
              <strong>Cuenta de demostración.</strong> No cargues datos reales: los pueden ver otros visitantes y todo
              se reinicia cada noche.
            </div>
          )}
          <Outlet />
        </main>
      </div>
    </TermsGate>
  );
};

export default Layout;
