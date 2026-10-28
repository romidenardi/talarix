import { createContext, useContext, useState } from 'react';
import { loginRequest } from '../api/auth.api.js';

const AuthContext = createContext();

export const useAuth = () => useContext(AuthContext);

const getStoredUser = () => {
  const raw = localStorage.getItem('user');
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

export const AuthProvider = ({ children }) => {
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [user, setUser] = useState(getStoredUser());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const login = async (email, password) => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await loginRequest(email, password);
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      setToken(data.token);
      setUser(data.user);
      return true;
    } catch (err) {
      setError(err.response?.data?.message || 'Error al iniciar sesión');
      return false;
    } finally {
      setLoading(false);
    }
  };

  // Si el superadmin activa o quita el módulo de mesas, el menú se actualiza sin volver a ingresar
  const setTablesEnabled = (enabled) => {
    setUser((current) => {
      if (!current || Boolean(current.tablesEnabled) === enabled) return current;
      const next = { ...current, tablesEnabled: enabled };
      localStorage.setItem('user', JSON.stringify(next));
      return next;
    });
  };

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{
        token,
        user,
        role: user?.role || null,
        isDemo: user?.businessType === 'demo',
        isClosing: user?.businessStatus === 'closing',
        tablesEnabled: Boolean(user?.tablesEnabled),
        setTablesEnabled,
        isAuthenticated: !!token,
        login,
        logout,
        loading,
        error,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
