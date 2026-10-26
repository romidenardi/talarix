import { validationResult } from 'express-validator';

export const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const list = errors.array();
    // message: el primer error, para mostrarlo en pantalla; errors: la lista completa
    return res.status(400).json({ message: list[0]?.msg || 'Revisá los datos', errors: list });
  }
  next();
};
