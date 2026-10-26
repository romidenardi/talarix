import { useForm } from 'react-hook-form';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';

const Login = () => {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm();
  const { login, loading, error } = useAuth();
  const navigate = useNavigate();

  const onSubmit = async (formData) => {
    const success = await login(formData.email, formData.password);
    if (success) navigate('/');
  };

  return (
    <div className="login-page">
      <form onSubmit={handleSubmit(onSubmit)}>
        <h1>Iniciar sesión</h1>

        <label htmlFor="email">Email</label>
        <input id="email" type="email" {...register('email', { required: 'El email es obligatorio' })} />
        {errors.email && <span className="error">{errors.email.message}</span>}

        <label htmlFor="password">Contraseña</label>
        <input id="password" type="password" {...register('password', { required: 'La contraseña es obligatoria' })} />
        {errors.password && <span className="error">{errors.password.message}</span>}

        {error && <p className="error">{error}</p>}

        <button type="submit" disabled={loading}>
          {loading ? 'Ingresando...' : 'Ingresar'}
        </button>

        <p>
          <Link to="/olvide-contrasena">¿Olvidaste tu contraseña?</Link>
        </p>
      </form>
    </div>
  );
};

export default Login;
