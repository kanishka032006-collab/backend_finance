require('./utils/runtimeConfig');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const prisma = require('./utils/prisma');
const errorHandler = require('./middleware/errorHandler');

// Route imports
const authRoutes = require('./routes/authRoutes');
const customerRoutes = require('./routes/customerRoutes');
const accountRoutes = require('./routes/accountRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const reportRoutes = require('./routes/reportRoutes');
const userRoutes = require('./routes/userRoutes');
const settingRoutes = require('./routes/settingRoutes');
const routeRoutes = require('./routes/routeRoutes');
const expenseRoutes = require('./routes/expenseRoutes');
const investmentRoutes = require('./routes/investmentRoutes');
const salaryRoutes = require('./routes/salaryRoutes');

const app = express();
const PORT = process.env.PORT || 5000;
const normalizeOrigin = (value) => {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
};
const allowedClientOrigins = new Set([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5174',
  'https://financefrontend-ten.vercel.app',
  'https://financefrontend-34q8d72sy-kanishka-0d2e.vercel.app',
  ...(process.env.CLIENT_URLS || '').split(',').map((origin) => origin.trim()).filter(Boolean),
  process.env.CLIENT_URL
].filter(Boolean).map(normalizeOrigin).filter(Boolean));

const isLocalDevOrigin = (origin) =>
  process.env.NODE_ENV !== 'production' &&
  /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);

// Security & Utility Middleware
app.use(helmet({
  crossOriginResourcePolicy: false,
}));
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedClientOrigins.has(origin) || isLocalDevOrigin(origin)) {
      return callback(null, true);
    }
    return callback(new Error(`Origin '${origin}' is not allowed by CORS.`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('dev'));
}

// Health check
app.get('/api/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      status: 'healthy',
      database: 'connected',
      service: 'TamilFins Finance Collection System',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[Health check] PostgreSQL connection failed:', error.code || error.name);
    res.status(503).json({
      status: 'unhealthy',
      database: 'disconnected',
      service: 'TamilFins Finance Collection System'
    });
  }
});

// Mount Routes
app.use('/api/auth', authRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/accounts', accountRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/users', userRoutes);
app.use('/api/settings', settingRoutes);
app.use('/api/routes', routeRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/investments', investmentRoutes);
app.use('/api/salary', salaryRoutes);

// 404 handler
app.use((req, res, next) => {
  res.status(404).json({
    success: false,
    message: `API endpoint ${req.originalUrl} not found.`
  });
});

// Central Error Handler
app.use(errorHandler);

// Start server if run directly
let server;
if (require.main === module) {
  server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`=======================================================`);
    console.log(`🚀 TAMILFINS SYSTEM BACKEND RUNNING ON PORT ${PORT}`);
    console.log(`🌐 Base URL: http://localhost:${PORT}`);
    console.log(`📡 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`=======================================================`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n❌ [TamilFins Error] Port ${PORT} is already in use by another running process.`);
      console.error(`👉 Solution: Kill the existing process on port ${PORT} using:`);
      console.error(`   Get-Process -Id (Get-NetTCPConnection -LocalPort ${PORT}).OwningProcess | Stop-Process -Force\n`);
    } else {
      console.error('Server error:', err);
    }
    process.exit(1);
  });
}

module.exports = app;
