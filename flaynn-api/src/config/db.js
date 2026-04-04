import pg from 'pg';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Requis pour se connecter à PostgreSQL sur Render en production
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

export async function initDB(logger) {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(254) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        failed_login_attempts INT DEFAULT 0,
        locked_until TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS scores (
        reference_id VARCHAR(50) PRIMARY KEY,
        user_email VARCHAR(254) REFERENCES users(email),
        startup_name VARCHAR(100),
        data JSONB NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS refresh_tokens (
        token_hash VARCHAR(128) PRIMARY KEY,
        user_email VARCHAR(254) NOT NULL REFERENCES users(email) ON DELETE CASCADE,
        expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
        revoked_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_email
      ON refresh_tokens(user_email);
    `);
    logger.info('[ARCHITECT-PRIME] PostgreSQL : Tables "users", "scores" et "refresh_tokens" synchronisées et prêtes.');
  } catch (err) {
    logger.error(err, '[FATAL] Erreur d\'initialisation PostgreSQL.');
    throw err;
  }
}
