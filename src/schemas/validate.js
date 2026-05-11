import logger from '../utils/logger.js';

export const validateBody = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    logger.warn('Request validation failed', {
      path: req.path,
      issues: result.error.issues,
    });
    const err = new Error('validation_error');
    err.status = 400;
    err.code = 'validation_error';
    err.issues = result.error.issues;
    return next(err);
  }
  req.body = result.data;
  next();
};
