import test from 'node:test';
import assert from 'node:assert';
import { app, start } from '../src/server.js';

test('🛡️ Sécurité & Observabilité (Phase 4)', async (t) => {
  // Initialisation de l'app pour les tests (sans écouter le port réseau)
  await start();

  await t.test('1. Architecture Observabilité : Les requêtes reçoivent le header Request-Id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/health'
    });
    assert.strictEqual(res.statusCode, 200);
    assert.ok(res.headers['x-request-id'], 'Le header X-Request-Id doit être présent');
  });

  await t.test('2. Zero Trust Zod : Rejet et caviardage des payloads de scoring malformés', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/score',
      payload: {
        startup_name: "A", // Trop court (min 2)
        email: "not-an-email" // Invalide
      }
    });
    
    const json = res.json();
    assert.strictEqual(res.statusCode, 422);
    assert.strictEqual(json.error, 'VALIDATION_FAILED');
    
    // Vérifie que Zod identifie exactement les champs incriminés
    assert.ok(json.details.startup_name, 'Doit identifier l\'erreur sur startup_name');
    assert.ok(json.details.email, 'Doit identifier l\'erreur sur email');
    assert.ok(json.details.sector, 'Doit identifier le secteur manquant');
  });

  t.after(async () => {
    await app.close();
  });
});