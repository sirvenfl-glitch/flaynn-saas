import { z } from 'zod';
import { FlaynnError } from '../utils/errors.js';

export function errorHandler(error, request, reply) {
  if (error.statusCode === 429) {
    return reply.code(429).send({
      error: 'TOO_MANY_REQUESTS',
      message: 'Vous avez dépassé la limite de requêtes autorisées.'
    });
  }

  // Interception automatique des erreurs de validation Zod
  if (error instanceof z.ZodError) {
    return reply.code(422).send({
      error: 'VALIDATION_FAILED',
      message: 'Données invalides',
      details: error.flatten().fieldErrors
    });
  }

  // Interception de nos erreurs métier sécurisées
  if (error instanceof FlaynnError) {
    request.log.warn({ err: error }, `FlaynnError: ${error.code}`);
    return reply.code(error.statusCode).send({
      error: error.code,
      message: error.message
    });
  }

  request.log.error({ err: error }, 'Unhandled Error');
  return reply.code(500).send({
    error: 'INTERNAL_SERVER_ERROR',
    reference: request.id // Permet au support de retrouver l'erreur exacte dans les logs
  });
}