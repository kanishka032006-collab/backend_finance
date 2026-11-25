const path = require('path');

// Load local settings for development. Render-provided environment variables
// take precedence because dotenv does not override existing process variables.
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const isProduction = process.env.NODE_ENV === 'production';
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required. Configure it in the service environment.');
}

if (isProduction) {
  let databaseAddress;
  try {
    databaseAddress = new URL(databaseUrl);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL connection URL.');
  }

  if (!['postgres:', 'postgresql:'].includes(databaseAddress.protocol)) {
    throw new Error('DATABASE_URL must use the PostgreSQL protocol.');
  }

  if (['localhost', '127.0.0.1', '::1', '[::1]'].includes(databaseAddress.hostname.toLowerCase())) {
    throw new Error('Production DATABASE_URL must point to a hosted PostgreSQL database, not localhost.');
  }

  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET is required in production. Configure it in the service environment.');
  }
}

module.exports = { isProduction };
