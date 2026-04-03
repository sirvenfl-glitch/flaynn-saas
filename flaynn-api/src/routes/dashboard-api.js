import { z } from 'zod';

const idSchema = z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/);

function mockDashboard(id) {
  const seed = id.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const score = 55 + (seed % 40);

  const pillars = [
    { name: 'Market', score: Math.min(100, 45 + ((seed * 3) % 45)) },
    { name: 'Product', score: Math.min(100, 50 + ((seed * 5) % 40)) },
    { name: 'Traction', score: Math.min(100, 40 + ((seed * 7) % 50)) },
    { name: 'Team', score: Math.min(100, 48 + ((seed * 11) % 40)) },
    { name: 'Execution', score: Math.min(100, 42 + ((seed * 13) % 48)) }
  ];

  return {
    id,
    startupName: id === 'demo' ? 'Startup démo' : `Dossier ${id}`,
    score,
    pillars,
    graph: {
      nodes: [
        { id: 'you', label: 'Vous', type: 'user' },
        { id: 'c1', label: 'Comp A', type: 'competitor' },
        { id: 'c2', label: 'Comp B', type: 'competitor' },
        { id: 'p1', label: 'Partenaire', type: 'partner' }
      ],
      links: [
        { source: 'you', target: 'c1', strength: 0.6 },
        { source: 'you', target: 'c2', strength: 0.4 },
        { source: 'you', target: 'p1', strength: 0.8 }
      ]
    },
    updatedAt: new Date().toISOString()
  };
}

export default async function dashboardApiRoutes(fastify) {
  fastify.get('/api/dashboard/:id', async (request, reply) => {
    const raw = request.params.id;
    const parsed = idSchema.safeParse(raw);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'INVALID_ID',
        message: 'Identifiant de dossier invalide.'
      });
    }
    return mockDashboard(parsed.data);
  });
}
