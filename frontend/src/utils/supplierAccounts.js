import { money } from './reportFormat.js';

// Saldo con su sentido: positivo, se le debe; negativo, saldo a favor
export const balanceLabel = (balance) => {
  const value = Number(balance) || 0;
  if (Math.abs(value) < 0.005) return 'Al día';
  return value > 0 ? `Le debés ${money(value)}` : `A favor ${money(-value)}`;
};
