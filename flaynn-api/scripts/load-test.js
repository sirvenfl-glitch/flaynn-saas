import autocannon from 'autocannon';
import { app, start } from '../src/server.js';

async function runLoadTest() {
  console.log('🚀 Démarrage du serveur pour le test de charge...');
  await start();
  
  const port = app.server.address().port;
  const url = `http://localhost:${port}/api/health`;

  console.log(`\n🔥 Lancement d'Autocannon sur ${url}`);
  console.log('Objectif : Dépasser 100 req/min pour déclencher Rate Limit (429) et Ban IP (403)');

  const instance = autocannon({
    url,
    connections: 50, // 50 connexions réseau simultanées
    pipelining: 1,
    duration: 5, // Durée du test court (5s)
    title: 'SecOps Rate Limit Test'
  });

  autocannon.track(instance, { renderProgressBar: true });

  instance.on('done', (result) => {
    console.log('\n📊 --- RÉSULTATS DU TEST DE CHARGE ---');
    console.log(`✅ Requêtes réussies (2xx) : ${result['2xx'] || 0}`);
    console.log(`🛡️ Requêtes bloquées (4xx) : ${result['4xx'] || 0}`);
    
    if ((result['4xx'] || 0) > 0) {
      console.log('\n🟢 SUCCÈS : Le Rate Limiter et Redis ont bloqué le trafic excédentaire (Défense Active opérationnelle).');
    } else {
      console.error('\n🔴 ÉCHEC : Aucune requête n\'a été bloquée. La limite n\'a pas été atteinte ou l\'IP est immunisée.');
    }
    
    process.exit(0);
  });
}

runLoadTest();
