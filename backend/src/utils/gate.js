// Limita cuántas tareas pesadas corren a la vez en este servidor (por ejemplo, la exportación
// completa de un comercio, que arma todo el Excel en memoria).
//
//   const gate = createGate({ max: 2, perKey: 1 });
//   const release = gate.tryEnter(businessId);   // null si no hay lugar
//   try { ... } finally { release(); }

export const createGate = ({ max, perKey = 1 }) => {
  let running = 0;
  const byKey = new Map();

  return {
    tryEnter(key) {
      const forKey = byKey.get(key) || 0;
      if (running >= max || forKey >= perKey) return null;
      running += 1;
      byKey.set(key, forKey + 1);

      let released = false;
      return () => {
        if (released) return;
        released = true;
        running -= 1;
        const left = byKey.get(key) - 1;
        if (left > 0) byKey.set(key, left);
        else byKey.delete(key);
      };
    },
    get running() {
      return running;
    },
  };
};
