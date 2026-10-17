import { Type } from 'class-transformer';
import {
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
} from 'class-validator';
import { COUNTERPART_STYLES, type ConversationMode } from '@contributor/shared';
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
}

export class CreateConversationDto {
  @IsIn(CONVERSATION_MODES)
  mode: ConversationMode;
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
}

export class TaskListQueryDto {
  @IsOptional()
  @IsIn(['created', 'validating', 'awaiting_approval', 'running', 'completed', 'failed', 'cancelled'])
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
