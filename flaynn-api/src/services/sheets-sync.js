import { IntegrationError } from '../utils/errors.js';

export const sheetsSyncService = {
  async appendRow(payload, reference) {
    const webhookUrl = process.env.GOOGLE_SHEETS_WEBHOOK_URL;
    
    // Si non configuré, la fonctionnalité est désactivée silencieusement
    if (!webhookUrl) return false;

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reference,
          startup_name: payload.startup_name,
          email: payload.email,
          sector: payload.sector,
          stage: payload.stage,
          revenue_monthly: payload.revenue_monthly || 0,
          team_size: payload.team_size || 0,
          pitch: payload.pitch,
          date: new Date().toISOString()
        }),
        signal: AbortSignal.timeout(10000) // Timeout strict
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return true;
    } catch (err) {
      throw new IntegrationError('Échec de la synchronisation vers Google Sheets', err.message);
    }
  }
};