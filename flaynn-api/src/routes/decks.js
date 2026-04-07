import { pool } from '../config/db.js';

export default async function decksRoutes(fastify) {
  fastify.get('/api/decks/:reference', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const { reference } = request.params;
    if (!reference || !/^[a-zA-Z0-9_-]+$/.test(reference)) {
      return reply.code(400).send({ error: 'INVALID_REF' });
    }
    try {
      const { rows } = await pool.query(
        `SELECT data->>'pitch_deck_base64' as pdf, startup_name FROM scores WHERE reference_id = $1`,
        [reference]
      );
      if (rows.length === 0 || !rows[0].pdf) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'PDF non disponible.' });
      }
      const pdfBuffer = Buffer.from(rows[0].pdf, 'base64');
      const filename = `PitchDeck-${rows[0].startup_name || reference}.pdf`;
      return reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .send(pdfBuffer);
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ error: 'INTERNAL_ERROR' });
    }
  });
}
