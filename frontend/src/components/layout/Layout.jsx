import { useEffect, useState } from 'react';
import { useDialog } from '../../context/DialogContext.jsx';
import { Outlet, NavLink, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import logo from '../../assets/logo.png';

const ROLE_LABELS = {
  admin: 'Administrador',
  editor: 'Editor',
  operador: 'Operador',
};

const Layout = () => {
  const { logout, role, user, isDemo, isClosing } = useAuth();
  const dialog = useDialog();
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

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

  const canManageData = role === 'admin' || role === 'editor';
  const isAdmin = role === 'admin';

  return (
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
          ) : (
            <>
              <NavLink to="/" end>
                Inicio
              </NavLink>
              {canManageData && <NavLink to="/reports">Reportes</NavLink>}
              {canManageData && <NavLink to="/products">Productos</NavLink>}
              {canManageData && <NavLink to="/categories">Categorías</NavLink>}
              {canManageData && <NavLink to="/payments">Formas de pago</NavLink>}
              {canManageData && <NavLink to="/customers">Clientes</NavLink>}
              <NavLink to="/orders">Remitos</NavLink>
              {canManageData && <NavLink to="/suppliers">Proveedores</NavLink>}
              <NavLink to="/purchases">Compras</NavLink>
              {canManageData && !isDemo && <NavLink to="/imports">Importar</NavLink>}
              {isAdmin && !isDemo && <NavLink to="/users">Usuarios</NavLink>}
              {isAdmin && !isDemo && <NavLink to="/exportar">Exportar mis datos</NavLink>}
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
            <strong>Cuenta de demostración.</strong> No cargues datos reales: los pueden ver otros visitantes y todo se
            reinicia cada noche.
          </div>
        )}
        <Outlet />
      </main>
    </div>
  );
};

export default Layout;
