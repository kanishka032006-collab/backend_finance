const errorHandler = (err, req, res, next) => {
  console.error('[Error Details]:', err);

  // Malformed JSON is a client request error, not an internal server failure.
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, message: 'Request body contains invalid JSON.' });
  }

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

  if (err.code === 'P1000') {
    return res.status(503).json({
      success: false,
      message: 'The database rejected its credentials. Check the backend DATABASE_URL configuration.'
    });
  }

  if (['P1001', 'P1002', 'P1008', 'P1017', 'P2024'].includes(err.code)) {
    return res.status(503).json({
      success: false,
      message: 'The database is temporarily unavailable or out of connections. Please try again shortly.'
    });
  }

  if (err.code === 'P2021' || err.code === 'P2022') {
    return res.status(500).json({
      success: false,
      message: 'The database schema is out of date. Apply pending Prisma migrations and restart the backend.'
    });
  }

  if (err.name === 'PrismaClientInitializationError' || /@prisma\/client did not initialize yet/i.test(err.message || '')) {
    return res.status(503).json({
      success: false,
      message: 'The database client is not initialized. Run the Prisma client generation step and restart the backend.'
    });
  }

  const statusCode = err.statusCode || err.status || 500;
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
