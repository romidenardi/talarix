export const forbidInDemo = (req, res, next) => {
  if (req.user?.businessType === 'demo') {
    return res.status(403).json({ message: 'Esta función no está disponible en la cuenta demo.' });
  }
  next();
};
