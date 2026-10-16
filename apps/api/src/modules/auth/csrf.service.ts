import { Injectable } from '@nestjs/common';

/**
 * CSRF token sinkron (double-submit terhadap secret per-sesi di server):
 * klien menerima token via /auth/me + cookie non-HttpOnly `ca_csrf`, lalu
 * mengirimnya sebagai header X-CSRF-Token pada setiap request yang mengubah data.
 */
@Injectable()
export class CsrfService {
  readonly headerName = 'x-csrf-token';

  isSafeMethod(method: string): boolean {
    return ['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());
  }
}
