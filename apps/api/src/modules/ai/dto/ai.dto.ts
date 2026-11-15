import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { COUNTERPART_STYLES, MEMORY_LIMITS, type ConversationMode } from '@bara/shared';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { AI_LIMITS } from '../limits';

export const COUNTERPART_STYLE_IDS = COUNTERPART_STYLES.map((style) => style.id) as [
  string,
  ...string[],
];

export const CONVERSATION_MODES: readonly ConversationMode[] = ['second_brain', 'counterpart'];

export class ChatRequestDto {
  @IsIn(CONVERSATION_MODES)
  mode: ConversationMode;

  @IsString()
  @MinLength(1)
  @MaxLength(AI_LIMITS.maxPromptLength)
  prompt: string;

  @IsOptional()
  @IsUUID('4')
  conversationId?: string;

  @IsOptional()
  @IsIn(COUNTERPART_STYLE_IDS)
  counterpartStyle?: string;

  @IsOptional()
  @IsBoolean()
  webSearch?: boolean;

  /** Model katalog pilihan pengguna untuk giliran ini (disimpan pada percakapan). */
  @IsOptional()
  @IsUUID()
  modelId?: string;
}

export class CreateConversationDto {
  @IsIn(CONVERSATION_MODES)
  mode: ConversationMode;

  @IsOptional()
  @IsUUID()
  modelId?: string;
}

export class UpdateAttachmentDto {
  @IsBoolean()
  enabled: boolean;
}

export class AddUrlAttachmentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2048)
  url: string;
}

export class ConversationListQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(CONVERSATION_MODES)
  mode?: ConversationMode;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}

export class UpdateConversationDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsBoolean()
  starred?: boolean;

  /** null = kembali ke urutan bawaan (preferensi pengguna, lalu model bawaan). */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  modelId?: string | null;
}

export class CreateTaskDto {
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title: string;

  @IsString()
  @MinLength(5)
  @MaxLength(AI_LIMITS.maxTaskInstructionLength)
  instruction: string;

  @IsOptional()
  @IsBoolean()
  webSearch?: boolean;

  /** Pintu memori (subjek bawahan) yang dibuka untuk tugas ini. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MEMORY_LIMITS.maxOpenDoors)
  @IsUUID('4', { each: true })
  memorySubjectIds?: string[];
}

export class TaskListQueryDto {
  @IsOptional()
  @IsIn([
    'created',
    'validating',
    'awaiting_approval',
    'running',
    'completed',
    'failed',
    'cancelled',
  ])
  status?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize: number = 20;

  get skip(): number {
    return (this.page - 1) * this.pageSize;
  }
}

export { SetConnectorAttachmentsDto as SetConversationConnectorsDto } from '../../connectors/dto/connectors.dto';

export class DecideToolApprovalDto {
  @IsIn(['approved', 'rejected'])
  decision: 'approved' | 'rejected';

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
