import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export const KNOWLEDGE_ORIGINS = ['manual', 'url', 'upload'] as const;
export const DOC_STATUSES = ['pending', 'indexed', 'failed'] as const;

export class CreateSourceDto {
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9-]{2,79}$/)
  code: string;

  @IsString()
  @MinLength(3)
  @MaxLength(200)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsIn(KNOWLEDGE_ORIGINS)
  origin: (typeof KNOWLEDGE_ORIGINS)[number];

  @IsOptional()
  @IsObject()
  acl?: { roles?: string[]; departments?: string[] };
}

export class UpdateSourceDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsObject()
  acl?: { roles?: string[]; departments?: string[] };
}

export class CreateDocumentDto {
  @IsUUID('4')
  sourceId: string;

  @IsString()
  @MinLength(3)
  @MaxLength(300)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  locator?: string;

  @IsString()
  @MinLength(10)
  @MaxLength(200_000)
  content: string;
}

export class UpdateDocumentDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  locator?: string;

  @IsOptional()
  @IsString()
  @MinLength(10)
  @MaxLength(200_000)
  content?: string;

  @IsOptional()
  @IsIn(DOC_STATUSES)
  status?: (typeof DOC_STATUSES)[number];
}

export class CreateCollectionDto {
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9-]{2,79}$/)
  code: string;

  @IsString()
  @MinLength(3)
  @MaxLength(200)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
}

export class UpdateCollectionDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
}

export class SetCollectionSourcesDto {
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('4', { each: true })
  sourceIds: string[];
}

export class DocumentsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID('4')
  sourceId?: string;

  @IsOptional()
  @IsIn(DOC_STATUSES)
  status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;
}

export class SearchKnowledgeDto {
  @IsString()
  @MinLength(2)
  @MaxLength(500)
  query: string;

  @IsOptional()
  @IsUUID('4', { each: true })
  sourceIds?: string[];

  @IsOptional()
  @IsUUID('4')
  collectionId?: string;
}
