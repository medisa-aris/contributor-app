import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@bara/shared';
import type { Response } from 'express';
import { CsrfExempt } from '../../common/decorators/csrf-exempt.decorator';
import { CurrentAuth } from '../../common/decorators/current-auth.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { AppError, ERROR_CODES } from '../../common/errors/app-error';
import type { AuthContext } from '../../common/types/auth-context';
import type { OfficeSourceKind } from './office-token';
import { OfficeService } from './office.service';

function parseKind(value: string): OfficeSourceKind {
  if (value === 'doc' || value === 'att') return value;
  throw new AppError(ERROR_CODES.notFound, 'Sumber berkas tidak dikenal.', 404);
}

/**
 * Integrasi OnlyOffice Docs.
 * - editor-config: dipanggil browser (sesi + izin dokumen).
 * - files / callback: dipanggil Document Server; tanpa cookie, diautentikasi token berkas + JWT.
 */
@ApiTags('ai-workspace')
@Controller('office')
export class OfficeController {
  constructor(private readonly office: OfficeService) {}

  @RequirePermission(PERMISSIONS.documentsManage)
  @Get(':kind/:id/editor-config')
  editorConfig(
    @CurrentAuth() auth: AuthContext,
    @Param('kind') kind: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.office.editorConfig(auth, parseKind(kind), id);
  }

  @Public()
  @CsrfExempt()
  @Get('files/:kind/:id')
  async file(
    @Param('kind') kind: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('t') t: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const file = await this.office.openFile(parseKind(kind), id, t, authorization);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', String(file.size));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    file.stream.pipe(res);
  }

  @Public()
  @CsrfExempt()
  @HttpCode(200)
  @Post('callback/:kind/:id')
  callback(
    @Param('kind') kind: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('t') t: string | undefined,
    @Body() body: Record<string, unknown>,
    @Headers('authorization') authorization: string | undefined,
  ) {
    return this.office.handleCallback(parseKind(kind), id, t, body ?? {}, authorization);
  }
}
