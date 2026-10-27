// La conexión con la base va cifrada por la red privada de Railway: todo el tráfico entre servicios
// del mismo proyecto viaja en túneles WireGuard. Para eso, DB_HOST tiene que ser la dirección interna
// (…railway.internal, por ejemplo mysql.railway.internal). Con la dirección pública (proxy TCP) el
// tráfico sale a internet sin cifrar, y los Términos prometen una conexión cifrada.
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1'];

export const isPrivateDbHost = (host) => {
  const value = String(host || '')
    .trim()
    .toLowerCase();
  return value.endsWith('.railway.internal') || LOCAL_HOSTS.includes(value);
};

// Railway define RAILWAY_ENVIRONMENT_NAME en sus servidores; en local no existe
export const runningOnRailway = (env = process.env) => Boolean(env.RAILWAY_ENVIRONMENT_NAME || env.RAILWAY_ENVIRONMENT);

export const dbHostWarning = (env = process.env) => {
  if (!runningOnRailway(env) || isPrivateDbHost(env.DB_HOST)) return null;
  return (
    `DB_HOST (${env.DB_HOST}) no es la red privada de Railway: la conexión con la base no va cifrada. ` +
    'Usar la dirección interna (MYSQLHOST del servicio MySQL, termina en .railway.internal).'
  );
};
