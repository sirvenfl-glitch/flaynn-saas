import fp from 'fastify-plugin';

export default fp(async function deviceDetect(fastify) {
  fastify.addHook('onRequest', async (request) => {
    const memory = parseFloat(request.headers['sec-ch-device-memory'] || '4');
    const ect = request.headers['ect'] || '4g';
    const saveData = request.headers['save-data'] === 'on';

    let tier = 3;
    if (saveData || ect === 'slow-2g' || ect === '2g') tier = 1;
    else if (memory <= 2 || ect === '3g') tier = 2;

    request.deviceTier = tier; // 1 (Low), 2 (Mid), 3 (High)
  });
});