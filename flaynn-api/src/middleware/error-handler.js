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

  // ARCHITECT-PRIME: préserver le statusCode d'origine quand Fastify lève une 4xx
  // (FST_ERR_CTP_*, FST_ERR_VALIDATION, etc.) — sinon une mauvaise requête client
  // était requalifiée en 500 et l'UX recevait un faux "erreur serveur".
  const status = Number.isInteger(error.statusCode) && error.statusCode >= 400 && error.statusCode < 600
    ? error.statusCode
    : 500;
  request.log.error({ err: error, status }, 'Unhandled Error');
  return reply.code(status).send({
    error: status >= 500 ? 'INTERNAL_SERVER_ERROR' : 'BAD_REQUEST',
    message: status >= 500
      ? `Une erreur inattendue est survenue. Communiquez la référence ${request.id} au support.`
      : (error.message || 'Requête invalide.'),
    reference: request.id
  });
}