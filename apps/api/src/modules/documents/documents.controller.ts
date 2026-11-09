import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PERMISSIONS } from '@bara/shared';
import type { Response } from 'express';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { CurrentAuth } from '../../common/decorators/current-auth.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { AuthContext } from '../../common/types/auth-context';
import { paginated } from '../admin/common/pagination';
import { DocumentsService } from './documents.service';

class DocumentListQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}

/** Dokumen hasil percakapan AI. Semua rute dibatasi ke pemilik dokumen. */
@ApiTags('ai-workspace')
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @RequirePermission(PERMISSIONS.documentsManage)
  @Get()
  async list(@CurrentAuth() auth: AuthContext, @Query() query: DocumentListQueryDto) {
    const { items, total } = await this.documents.list(auth.user.id, {
      search: query.search,
      skip: query.skip,
      take: query.pageSize,
    });
    return paginated(items, { page: query.page, limit: query.pageSize, offset: query.skip }, total);
  }

  @RequirePermission(PERMISSIONS.documentsManage)
  @Get(':id/preview')
  preview(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.documents.preview(auth.user.id, id);
  }

  @RequirePermission(PERMISSIONS.documentsManage)
  @Get(':id/download')
  async download(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('inline') inline: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const file = await this.documents.download(auth.user.id, id);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Konten buatan model tidak pernah dijalankan dari origin aplikasi.
    res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:");
    res.setHeader(
      'Content-Disposition',
      `${inline === '1' ? 'inline' : 'attachment'}; filename="${file.fileName}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
    );
    res.setHeader('Content-Length', String(file.buffer.length));
    res.end(file.buffer);
  }

  @RequirePermission(PERMISSIONS.documentsManage)
  @HttpCode(204)
  @Delete(':id')
  async remove(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.documents.remove(auth.user.id, id);
  }
}
