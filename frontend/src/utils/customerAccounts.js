import { money } from './reportFormat.js';

// Saldo de un cliente con su sentido: positivo, el cliente debe; negativo, tiene saldo a favor
export const customerBalanceLabel = (balance) => {
  const value = Number(balance) || 0;
  if (Math.abs(value) < 0.005) return 'Al día';
  return value > 0 ? `Debe ${money(value)}` : `A favor ${money(-value)}`;
};
