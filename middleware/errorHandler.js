const errorHandler = (err, req, res, next) => {
  console.error('[Error Details]:', err);

  // Prisma known errors
  if (err.code === 'P2002') {
    const field = err.meta?.target?.[0] || 'field';
    return res.status(400).json({
      success: false,
      message: `A record with this ${field} already exists.`
    });
  }

  if (err.code === 'P2025') {
    return res.status(404).json({
      success: false,
      message: 'Record not found.'
    });
  }

  if (['P1000', 'P1001', 'P1002', 'P1017'].includes(err.code)) {
    return res.status(503).json({
      success: false,
      message: 'The database is temporarily unavailable. Please try again shortly.'
    });
  }

  const statusCode = err.statusCode || 500;
  const message = process.env.NODE_ENV === 'development'
    ? err.message || 'Internal Server Error'
    : 'Internal Server Error';

  res.status(statusCode).json({
    success: false,
    message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
};

module.exports = errorHandler;
