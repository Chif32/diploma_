require('dotenv').config();

const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('DATABASE_URL is not set in .env');
  process.exit(1);
}

const pool = new Pool({
  connectionString,
});

module.exports = {
  query: (text, params) => pool.query(text, params),
};

