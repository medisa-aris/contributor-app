import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { TEST_PASSWORD } from './reset-db';

export interface AuthedClient {
  cookies: string[];
  csrfToken: string;
  userId: string;
  email: string;
}

export async function loginAs(
  app: INestApplication,
  email: string,
  password: string = TEST_PASSWORD,
): Promise<AuthedClient> {
  const res = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email, password })
    .expect(200);
  const setCookie = (res.headers['set-cookie'] as unknown as string[]) ?? [];
  const cookies = setCookie.map((cookie) => cookie.split(';')[0] ?? '');
  return {
    cookies,
    csrfToken: res.body.data.csrfToken as string,
    userId: res.body.data.user.id as string,
    email,
  };
}

/** Klien terautentikasi: cookie sesi selalu disertakan, header CSRF untuk request non-GET. */
export function asClient(app: INestApplication, client: AuthedClient) {
  const server = app.getHttpServer();
  return {
    get: (url: string) => request(server).get(url).set('Cookie', client.cookies),
    post: (url: string, body?: unknown) =>
      request(server)
        .post(url)
        .set('Cookie', client.cookies)
        .set('X-CSRF-Token', client.csrfToken)
        .send(body ?? {}),
    patch: (url: string, body?: unknown) =>
      request(server)
        .patch(url)
        .set('Cookie', client.cookies)
        .set('X-CSRF-Token', client.csrfToken)
        .send(body ?? {}),
    put: (url: string, body?: unknown) =>
      request(server)
        .put(url)
        .set('Cookie', client.cookies)
        .set('X-CSRF-Token', client.csrfToken)
        .send(body ?? {}),
    delete: (url: string) =>
      request(server)
        .delete(url)
        .set('Cookie', client.cookies)
        .set('X-CSRF-Token', client.csrfToken),
  };
}
