import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Scope,
  type ArgumentMetadata,
  type PipeTransform,
} from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { formatIssues } from '@ticketdesk/shared';
import type { Request } from 'express';
import { isZodParamMetadata, type RequestSource } from './zod-param.decorators';

function isNonEmptyObject(value: unknown): boolean {
  return typeof value === 'object' && value !== null && Object.keys(value).length > 0;
}

/**
 * The single validation boundary. Registered globally as `APP_PIPE`, it parses
 * the value declared by `@ZodBody` / `@ZodQuery` / `@ZodParam`, rejects unknown
 * keys (the schemas are strict), and writes the parsed value back onto the
 * request so only one representation is in flight.
 *
 * It is request-scoped because both the write-back and the forgotten-schema
 * error need the request itself.
 */
@Injectable({ scope: Scope.REQUEST })
export class ZodValidationPipe implements PipeTransform {
  constructor(@Inject(REQUEST) private readonly request: Request) {}

  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    const data = metadata.data as unknown;

    if (isZodParamMetadata(data)) {
      const result = data.schema.safeParse(value);

      if (!result.success) {
        throw new BadRequestException(formatIssues(result.error.issues));
      }

      this.writeBack(data.source, result.data);
      return result.data;
    }

    // A route that forgot its schema must fail the first time it is called, not
    // silently accept any shape. A bodyless POST is exempt by construction.
    if (metadata.type === 'body' && isNonEmptyObject(value)) {
      throw new InternalServerErrorException(
        `No Zod schema registered for ${this.request.method} ${this.request.originalUrl}`,
      );
    }

    return value;
  }

  private writeBack(source: RequestSource, parsed: unknown): void {
    if (source === 'query') {
      // Express defines `query` as a getter-only accessor on the request prototype.
      Object.defineProperty(this.request, 'query', {
        value: parsed,
        writable: true,
        configurable: true,
        enumerable: true,
      });
      return;
    }

    this.request[source] = parsed as never;
  }
}
