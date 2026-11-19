import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Request, Response } from 'express';

export interface ProblemDetailsResponse {
  type: string;
  title: string;
  status: number;
  detail: string | string[];
  instance: string;
  timestamp: string;
  code?: string;
  stack?: string;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly isProduction: boolean = process.env.NODE_ENV === 'production') {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const problem = this.mapExceptionToProblem(exception, request);

    if (problem.status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `Unhandled error on ${request.method} ${request.url}: ${problem.title}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    response.status(problem.status).type('application/problem+json').json(problem);
  }

  private mapExceptionToProblem(exception: unknown, request: Request): ProblemDetailsResponse {
    const timestamp = new Date().toISOString();
    const instance = request.originalUrl || request.url;

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      let detail: string | string[] = exception.message;

      if (typeof body === 'object' && body !== null && 'message' in body) {
        const msg = (body as { message?: string | string[] }).message;
        if (msg !== undefined) {
          detail = msg;
        }
      }

      return {
        type: `https://sokokuu.tz/problems/http-${status}`,
        title: HttpStatus[status] || 'HTTP Error',
        status,
        detail,
        instance,
        timestamp,
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.mapPrismaKnownError(exception, instance, timestamp);
    }

    if (exception instanceof Prisma.PrismaClientValidationError) {
      return {
        type: 'https://sokokuu.tz/problems/database-validation',
        title: 'Database Query Validation Error',
        status: HttpStatus.BAD_REQUEST,
        detail: this.isProduction
          ? 'Invalid request payload for database operation.'
          : exception.message,
        instance,
        timestamp,
      };
    }

    // body-parser / raw-body reject oversized request bodies with a 413.
    // These are client errors — map them correctly instead of logging them as
    // unhandled 500s (which also pollutes error logs and hides real failures).
    const bodyError = exception as { status?: number; type?: string };
    if (
      bodyError?.status === HttpStatus.PAYLOAD_TOO_LARGE ||
      bodyError?.type === 'entity.too.large' ||
      (exception instanceof Error && exception.name === 'PayloadTooLargeError')
    ) {
      return {
        type: 'https://sokokuu.tz/problems/http-413',
        title: HttpStatus[HttpStatus.PAYLOAD_TOO_LARGE],
        status: HttpStatus.PAYLOAD_TOO_LARGE,
        detail: 'Request payload is too large. Please reduce the size of your request.',
        instance,
        timestamp,
      };
    }

    const base: ProblemDetailsResponse = {
      type: 'https://sokokuu.tz/problems/internal-server-error',
      title: 'Internal Server Error',
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      detail: this.isProduction
        ? 'An unexpected internal error occurred.'
        : exception instanceof Error
          ? exception.message
          : 'Unknown internal error',
      instance,
      timestamp,
    };

    if (!this.isProduction && exception instanceof Error && exception.stack) {
      base.stack = exception.stack;
    }

    return base;
  }

  private mapPrismaKnownError(
    err: Prisma.PrismaClientKnownRequestError,
    instance: string,
    timestamp: string,
  ): ProblemDetailsResponse {
    switch (err.code) {
      case 'P2002':
        return {
          type: 'https://sokokuu.tz/problems/unique-conflict',
          title: 'Resource Conflict',
          status: HttpStatus.CONFLICT,
          detail: 'A record with the supplied unique identifier already exists.',
          code: err.code,
          instance,
          timestamp,
        };
      case 'P2025':
        return {
          type: 'https://sokokuu.tz/problems/not-found',
          title: 'Resource Not Found',
          status: HttpStatus.NOT_FOUND,
          detail: 'The requested record could not be found.',
          code: err.code,
          instance,
          timestamp,
        };
      case 'P2034':
        return {
          type: 'https://sokokuu.tz/problems/serialization-conflict',
          title: 'Concurrent Transaction Conflict',
          status: HttpStatus.CONFLICT,
          detail: 'Transaction conflicted with a concurrent update; please retry.',
          code: err.code,
          instance,
          timestamp,
        };
      case 'P2003':
        return {
          type: 'https://sokokuu.tz/problems/foreign-key-violation',
          title: 'Invalid Reference',
          status: HttpStatus.BAD_REQUEST,
          detail: 'Referenced entity does not exist or cannot be modified.',
          code: err.code,
          instance,
          timestamp,
        };
      default:
        return {
          type: 'https://sokokuu.tz/problems/database-error',
          title: 'Database Operation Failed',
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          detail: this.isProduction ? 'Database operation could not be completed.' : err.message,
          code: err.code,
          instance,
          timestamp,
        };
    }
  }
}
