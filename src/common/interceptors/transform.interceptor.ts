import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface Response<T> {
  data: T;
  meta?: {
    total?: number;
    page?: number;
    limit?: number;
    totalPages?: number;
    nextCursor?: string;
    hasMore?: boolean;
  };
}

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<
  T,
  Response<T>
> {
  private readonly logger = new Logger(TransformInterceptor.name);

  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<Response<T>> {
    const request = context.switchToHttp().getRequest();
    const now = Date.now();

    return next.handle().pipe(
      map((data) => {
        // If data is already in the expected format, return as-is
        if (data && typeof data === 'object' && 'data' in data) {
          return data;
        }

        // Wrap in envelope
        const response: Response<T> = { data };

        // Log response
        const duration = Date.now() - now;
        this.logger.debug(
          `${request.method} ${request.url} - ${context.switchToHttp().getResponse().statusCode} - ${duration}ms`,
        );

        return response;
      }),
    );
  }
}
