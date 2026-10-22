import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { RequestSchema } from './request-schema';

export type RequestSource = 'body' | 'query' | 'params';

export interface ZodParamMetadata<T = unknown> {
  readonly kind: 'zod-param';
  readonly source: RequestSource;
  readonly schema: RequestSchema<T>;
}

export function isZodParamMetadata(value: unknown): value is ZodParamMetadata {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { kind?: unknown }).kind === 'zod-param'
  );
}

const extractZodParam = createParamDecorator(
  (metadata: ZodParamMetadata, context: ExecutionContext) => {
    const request = context.switchToHttp().getRequest<Request>();
    return request[metadata.source];
  },
);

function zodParam<T>(source: RequestSource, schema: RequestSchema<T>): ParameterDecorator {
  const metadata: ZodParamMetadata<T> = { kind: 'zod-param', source, schema };

  // Nest types `data` as a string, but passes it through untouched. Carrying the
  // schema here is the only per-parameter channel a pipe can see.
  return extractZodParam(metadata);
}

export function ZodBody<T>(schema: RequestSchema<T>): ParameterDecorator {
  return zodParam('body', schema);
}

export function ZodQuery<T>(schema: RequestSchema<T>): ParameterDecorator {
  return zodParam('query', schema);
}

export function ZodParam<T>(schema: RequestSchema<T>): ParameterDecorator {
  return zodParam('params', schema);
}
