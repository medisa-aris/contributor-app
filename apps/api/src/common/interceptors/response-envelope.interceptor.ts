import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

/** Wraps successful responses as { data, meta? }. Payloads that already carry data/meta pass through. */
@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(map((body: unknown) => this.envelope(body)));
  }

  private envelope(body: unknown): unknown {
    if (body === undefined || body === null) {
      return { data: null };
    }
    if (typeof body === 'object' && ('data' in body || 'error' in body)) {
      return body;
    }
    return { data: body };
  }
}
