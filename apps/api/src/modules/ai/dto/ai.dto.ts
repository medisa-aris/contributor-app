import { Type } from 'class-transformer';
import {
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
import { AI_LIMITS } from '../limits';

export const COUNTERPART_STYLE_IDS = COUNTERPART_STYLES.map((style) => style.id) as [
  string,
  ...string[],
];

export class ChatRequestDto {
  @IsIn(['second_brain', 'counterpart'])
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
