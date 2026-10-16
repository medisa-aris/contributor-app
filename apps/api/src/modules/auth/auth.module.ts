import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { CsrfService } from './csrf.service';
import { LoginLockoutService } from './login-lockout.service';
import { SessionService } from './session.service';

@Module({
  controllers: [AuthController],
  providers: [SessionService, CsrfService, LoginLockoutService, AuthService],
  exports: [SessionService, AuthService, CsrfService],
})
export class AuthModule {}
