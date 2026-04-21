import pg from 'pg';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Requis pour se connecter à PostgreSQL sur Render en production
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  // ARCHITECT-PRIME: Timeout court pour ne pas bloquer le startup sur Render cold start.
  // Sans ça, chaque tentative pend ~75s (TCP timeout OS) → dépasse le health check Render.
  connectionTimeoutMillis: 5000,
  max: 10,
  idleTimeoutMillis: 30000
});

export async function initDB(logger, retries = 8, delay = 2000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
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

        CREATE INDEX IF NOT EXISTS idx_scores_user_email
        ON scores(user_email);

        -- ======================================================================
        -- Delta 12 — Onboarding Business Angels (BA)
        -- ARCHITECT-PRIME: enums créés via DO/EXCEPTION pour idempotence inter-versions PG.
        -- ======================================================================
        DO $$ BEGIN
          CREATE TYPE ba_status AS ENUM ('pending', 'active', 'paused', 'cancelled', 'rejected');
        EXCEPTION WHEN duplicate_object THEN NULL; END $$;

        DO $$ BEGIN
          CREATE TYPE intro_status AS ENUM (
            'pending_founder', 'founder_notified', 'founder_accepted',
            'founder_declined', 'meeting_scheduled', 'cancelled'
          );
        EXCEPTION WHEN duplicate_object THEN NULL; END $$;

        CREATE TABLE IF NOT EXISTS business_angels (
          id                     SERIAL PRIMARY KEY,
          first_name             VARCHAR(80)  NOT NULL,
          last_name              VARCHAR(80)  NOT NULL,
          email                  VARCHAR(254) NOT NULL,
          linkedin_url           VARCHAR(500) NOT NULL,
          exit_context           TEXT,
          thesis                 JSONB        NOT NULL,
          referral_source        VARCHAR(200),
          stripe_customer_id     VARCHAR(255),
          stripe_subscription_id VARCHAR(255),
          status                 ba_status    NOT NULL DEFAULT 'pending',
          consent_rgpd_at        TIMESTAMP WITH TIME ZONE NOT NULL,
          created_at             TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
          activated_at           TIMESTAMP WITH TIME ZONE,
          paused_at              TIMESTAMP WITH TIME ZONE,
          cancelled_at           TIMESTAMP WITH TIME ZONE,
          validated_by_admin_at  TIMESTAMP WITH TIME ZONE,
          admin_notes            TEXT
        );

        -- Dédup applicative : un seul dossier "vivant" par email à la fois.
        CREATE UNIQUE INDEX IF NOT EXISTS idx_ba_email_active
          ON business_angels(email)
          WHERE status IN ('pending', 'active', 'paused');

        CREATE INDEX IF NOT EXISTS idx_ba_status
          ON business_angels(status);
        CREATE INDEX IF NOT EXISTS idx_ba_stripe_customer
          ON business_angels(stripe_customer_id);
        CREATE INDEX IF NOT EXISTS idx_ba_stripe_sub
          ON business_angels(stripe_subscription_id);
        CREATE INDEX IF NOT EXISTS idx_ba_thesis
          ON business_angels USING GIN (thesis);

        -- intro_requests : pas de FK vers public_cards (table livrée par delta 9, absente ici).
        -- Le check d'existence de la card est fait côté applicatif au moment de l'INSERT.
        -- TODO(delta-9) : ajouter FK card_id -> public_cards(id) ON DELETE CASCADE quand la table existera.
        CREATE TABLE IF NOT EXISTS intro_requests (
          id                    SERIAL PRIMARY KEY,
          ba_id                 INTEGER      NOT NULL REFERENCES business_angels(id) ON DELETE CASCADE,
          card_id               INTEGER      NOT NULL,
          message               TEXT,
          status                intro_status NOT NULL DEFAULT 'pending_founder',
          created_at            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
          updated_at            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
          founder_decided_at    TIMESTAMP WITH TIME ZONE,
          meeting_scheduled_at  TIMESTAMP WITH TIME ZONE
        );

        CREATE INDEX IF NOT EXISTS idx_intro_ba     ON intro_requests(ba_id);
        CREATE INDEX IF NOT EXISTS idx_intro_card   ON intro_requests(card_id);
        CREATE INDEX IF NOT EXISTS idx_intro_status ON intro_requests(status);

        CREATE TABLE IF NOT EXISTS ba_digests (
          id          SERIAL PRIMARY KEY,
          ba_id       INTEGER     NOT NULL REFERENCES business_angels(id) ON DELETE CASCADE,
          sent_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
          card_ids    INTEGER[]   NOT NULL,
          opened_at   TIMESTAMP WITH TIME ZONE,
          clicked_at  TIMESTAMP WITH TIME ZONE
        );

        CREATE INDEX IF NOT EXISTS idx_digests_ba ON ba_digests(ba_id);

        -- ======================================================================
        -- Delta 9 — Flaynn Score Cards publiques partageables
        -- FK reference_id → scores(reference_id) ON DELETE RESTRICT : si un scoring
        -- est supprimé par erreur, la card publique doit lever une erreur, pas
        -- disparaître silencieusement (audit trail).
        -- id SERIAL conservé pour la FK future intro_requests.card_id (delta 12).
        -- ======================================================================
        CREATE TABLE IF NOT EXISTS public_cards (
          id              SERIAL PRIMARY KEY,
          slug            VARCHAR(80)  NOT NULL UNIQUE,
          reference_id    VARCHAR(50)  NOT NULL REFERENCES scores(reference_id) ON DELETE RESTRICT,
          user_email      VARCHAR(254) NOT NULL,
          startup_name    VARCHAR(120) NOT NULL,
          snapshot_data   JSONB        NOT NULL,
          og_image_path   VARCHAR(255),
          is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
          index_seo       BOOLEAN      NOT NULL DEFAULT TRUE,
          view_count      INTEGER      NOT NULL DEFAULT 0,
          created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
          unpublished_at  TIMESTAMP WITH TIME ZONE
        );

        CREATE INDEX IF NOT EXISTS idx_public_cards_reference ON public_cards(reference_id);
        CREATE INDEX IF NOT EXISTS idx_public_cards_active    ON public_cards(is_active) WHERE is_active = TRUE;
        CREATE INDEX IF NOT EXISTS idx_public_cards_email     ON public_cards(user_email);
        CREATE INDEX IF NOT EXISTS idx_public_cards_created   ON public_cards(created_at DESC);

        -- ======================================================================
        -- Delta 14 — Gating de la création de compte sur scoring certifié.
        -- Le token clair n'existe qu'en mémoire le temps d'être renvoyé à n8n
        -- pour l'email fondateur ; seul le SHA-256 hex (64 chars) est stocké ici.
        -- ON DELETE CASCADE : si le scoring est purgé, l'invitation l'est aussi.
        -- ======================================================================
        CREATE TABLE IF NOT EXISTS account_activations (
          token_hash    VARCHAR(64)  PRIMARY KEY,
          email         VARCHAR(254) NOT NULL,
          reference_id  VARCHAR(50)  NOT NULL REFERENCES scores(reference_id) ON DELETE CASCADE,
          expires_at    TIMESTAMP WITH TIME ZONE NOT NULL,
          used_at       TIMESTAMP WITH TIME ZONE,
          created_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_activations_email     ON account_activations(email);
        CREATE INDEX IF NOT EXISTS idx_activations_reference ON account_activations(reference_id);
      `);
      logger.info('[ARCHITECT-PRIME] PostgreSQL : Tables "users", "scores", "refresh_tokens", "business_angels", "intro_requests", "ba_digests", "public_cards", "account_activations" synchronisées et prêtes.');
      return;
    } catch (err) {
      if (attempt === retries) {
        logger.error(err, '[FATAL] Erreur d\'initialisation PostgreSQL après %d tentatives.', retries);
        throw err;
      }
      // ARCHITECT-PRIME: Backoff exponentiel plafonné à 10s.
      // Avec connectionTimeoutMillis=5s, chaque tentative échoue vite.
      // 8 tentatives × (5s timeout + backoff) ≈ 60s max — dans la fenêtre Render.
      const backoff = Math.min(delay * Math.pow(1.5, attempt - 1), 10000);
      logger.warn(`[DB] Tentative ${attempt}/${retries} échouée (${err.code || err.message}), retry dans ${(backoff / 1000).toFixed(1)}s...`);
      await new Promise(r => setTimeout(r, backoff));
    }
  }
}
