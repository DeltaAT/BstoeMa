import { ApiErrorEnvelopeSchema } from "@bstoema/shared-types";
import { hasZodFastifySchemaValidationErrors, isResponseSerializationError } from "fastify-type-provider-zod";
import type { FastifyInstance } from "fastify";
import { ApiError } from "../domain/api-error";

export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) {
      return reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
        },
      });
    }

    if (hasZodFastifySchemaValidationErrors(error)) {
      const payload = {
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid request",
          details: error.validation,
        },
      };
      return reply.status(400).send(ApiErrorEnvelopeSchema.parse(payload));
    }

    if (isResponseSerializationError(error)) {
      const payload = {
        error: {
          code: "RESPONSE_SERIALIZATION_ERROR",
          message: "Response payload failed validation",
          details: error.cause,
        },
      };
      return reply.status(500).send(ApiErrorEnvelopeSchema.parse(payload));
    }

    request.log.error(error);
    return reply.status(500).send({
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "Unexpected server error",
      },
    });
  });
}

