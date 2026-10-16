import { SetMetadata } from '@nestjs/common';

export const CSRF_EXEMPT_KEY = 'csrfExempt';

/** Menandai route yang dikecualikan dari pemeriksaan CSRF (mis. login). */
export const CsrfExempt = (): MethodDecorator & ClassDecorator =>
  SetMetadata(CSRF_EXEMPT_KEY, true);
