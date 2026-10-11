'use strict';

const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

// `node server.js` does not load .env automatically. Keep direct local starts
// working while allowing deployment-provided environment variables to win.
const envPath = path.join(__dirname, '.env');
if (!process.env.DATABASE_URL && fsSync.existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required. Configure it for local PostgreSQL or your hosted PostgreSQL provider.');
}

// pg-connection-string currently treats `require` as `verify-full` and warns
// about its upcoming major-version semantics change. Make that behavior explicit.
const connectionString = process.env.DATABASE_URL.replace(
  /([?&])sslmode=(?:prefer|require|verify-ca)(?=(&|$))/i,
  '$1sslmode=verify-full',
);

const pool = new Pool({
  connectionString,
  // Let pg-connection-string honor sslmode=require in Neon URLs. Supplying
  // `ssl` alongside sslmode in the URL can replace URL-derived TLS settings.
  ssl: /[?&]sslmode=/i.test(process.env.DATABASE_URL)
    ? undefined
    : process.env.PGSSLMODE === 'require' || process.env.DATABASE_URL.includes('.render.com')
      ? { rejectUnauthorized: false }
      : undefined,
  max: Number(process.env.PGPOOL_MAX) || 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on('error', error => console.error('Unexpected PostgreSQL pool error:', error));

async function initializeDatabase() {
  const schema = await fs.readFile(path.join(__dirname, 'db', 'schema.sql'), 'utf8');
  await pool.query(schema);
}

module.exports = { pool, initializeDatabase };
