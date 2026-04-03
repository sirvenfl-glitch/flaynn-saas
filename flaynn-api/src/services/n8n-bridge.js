import { IntegrationError } from '../utils/errors.js';

export const n8nBridge = {
  async submitScore(payload, requestId) {
    const webhookUrl = process.env.N8N_WEBHOOK_URL;
    const secretToken = process.env.N8N_SECRET_TOKEN;

    if (!webhookUrl) {
      throw new IntegrationError('Webhook n8n non configuré.');
    }

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Flaynn-Source': 'web-api',
          'X-Flaynn-Signature': secretToken || '',
          'X-Request-Id': requestId || '' // Traçabilité de bout en bout
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000)
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return true;
    } catch (err) {
      throw new IntegrationError('Échec de la soumission au workflow IA n8n', err.message);
    }
  }
};