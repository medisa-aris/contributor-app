import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@bara/shared';
import { CurrentAuth } from '../../common/decorators/current-auth.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import type { AuthContext } from '../../common/types/auth-context';
import { paginated } from '../admin/common/pagination';
import {
  CreateCollectionDto,
  CreateDocumentDto,
  CreateSourceDto,
  DocumentsQueryDto,
  SearchKnowledgeDto,
  SetCollectionSourcesDto,
  UpdateCollectionDto,
  UpdateDocumentDto,
  UpdateSourceDto,
} from './dto/knowledge.dto';
import { KnowledgeService } from './knowledge.service';

@ApiTags('knowledge-center')
@Controller('knowledge')
export class KnowledgeController {
  constructor(private readonly knowledge: KnowledgeService) {}

  // ---- Sumber pengetahuan ----

  @RequirePermission(PERMISSIONS.knowledgeDocumentsRead)
  @Get('sources')
  async listSources(@CurrentAuth() auth: AuthContext, @Query() query: PaginationQueryDto) {
    const { items, total } = await this.knowledge.listSources(auth, {
      skip: query.skip,
      take: query.pageSize,
    });
    return paginated(items, { page: query.page, limit: query.pageSize, offset: query.skip }, total);
  }

  @RequirePermission(PERMISSIONS.knowledgeCollectionsManage)
  @Post('sources')
  createSource(@CurrentAuth() auth: AuthContext, @Body() dto: CreateSourceDto) {
    return this.knowledge.createSource(auth, dto);
  }

  @RequirePermission(PERMISSIONS.knowledgeCollectionsManage)
  @Patch('sources/:id')
  updateSource(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string,
    @Body() dto: UpdateSourceDto,
  ) {
    return this.knowledge.updateSource(auth, id, dto);
  }

  @RequirePermission(PERMISSIONS.knowledgeCollectionsManage)
  @Delete('sources/:id')
  async deleteSource(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string,
  ) {
    await this.knowledge.deleteSource(auth, id);
    return { deleted: true };
  }

  // ---- Dokumen ----

  @RequirePermission(PERMISSIONS.knowledgeDocumentsRead)
  @Get('documents')
  async listDocuments(@CurrentAuth() auth: AuthContext, @Query() query: DocumentsQueryDto) {
    const { items, total } = await this.knowledge.listDocuments(auth, {
      sourceId: query.sourceId,
      status: query.status,
      search: query.search,
      skip: query.skip,
      take: query.pageSize,
    });
    return paginated(items, { page: query.page, limit: query.pageSize, offset: query.skip }, total);
  }

  @RequirePermission(PERMISSIONS.knowledgeDocumentsRead)
  @Get('documents/:id/content')
  documentContent(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string,
  ) {
    return this.knowledge.documentContent(auth, id);
  }

  @RequirePermission(PERMISSIONS.knowledgeCollectionsManage)
  @Post('documents')
  createDocument(@CurrentAuth() auth: AuthContext, @Body() dto: CreateDocumentDto) {
    return this.knowledge.createDocument(auth, dto);
  }

  @RequirePermission(PERMISSIONS.knowledgeCollectionsManage)
  @Patch('documents/:id')
  updateDocument(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string,
    @Body() dto: UpdateDocumentDto,
  ) {
    return this.knowledge.updateDocument(auth, id, dto);
  }

  @RequirePermission(PERMISSIONS.knowledgeCollectionsManage)
  @Delete('documents/:id')
  async deleteDocument(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string,
  ) {
    await this.knowledge.deleteDocument(auth, id);
    return { deleted: true };
  }

  // ---- Koleksi ----

  @RequirePermission(PERMISSIONS.knowledgeCollectionsRead)
  @Get('collections')
  async listCollections(@Query() query: PaginationQueryDto) {
    const { items, total } = await this.knowledge.listCollections({
      skip: query.skip,
      take: query.pageSize,
    });
    return paginated(items, { page: query.page, limit: query.pageSize, offset: query.skip }, total);
  }

  @RequirePermission(PERMISSIONS.knowledgeCollectionsRead)
  @Get('collections/:id')
  collectionDetail(@Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string) {
    return this.knowledge.collectionDetail(id);
  }

  @RequirePermission(PERMISSIONS.knowledgeCollectionsManage)
  @Post('collections')
  createCollection(@CurrentAuth() auth: AuthContext, @Body() dto: CreateCollectionDto) {
    return this.knowledge.createCollection(auth, dto);
  }

  @RequirePermission(PERMISSIONS.knowledgeCollectionsManage)
  @Patch('collections/:id')
  updateCollection(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string,
    @Body() dto: UpdateCollectionDto,
  ) {
    return this.knowledge.updateCollection(auth, id, dto);
  }

  @RequirePermission(PERMISSIONS.knowledgeCollectionsManage)
  @Delete('collections/:id')
  async deleteCollection(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string,
  ) {
    await this.knowledge.deleteCollection(auth, id);
    return { deleted: true };
  }

  @RequirePermission(PERMISSIONS.knowledgeCollectionsManage)
  @Put('collections/:id/sources')
  setCollectionSources(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string,
    @Body() dto: SetCollectionSourcesDto,
  ) {
    return this.knowledge.setCollectionSources(auth, id, dto);
  }

  // ---- Pencarian ----

  @RequirePermission(PERMISSIONS.knowledgeSearchUse)
  @HttpCode(200)
  @Post('search')
  search(@CurrentAuth() auth: AuthContext, @Body() dto: SearchKnowledgeDto) {
    return this.knowledge.search(auth, dto);
  }
}
