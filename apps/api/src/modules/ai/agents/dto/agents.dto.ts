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
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ConnectorAttachmentDto } from '../../../connectors/dto/connectors.dto';
import { AI_LIMITS } from '../../limits';

export class PersonalAgentDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsString()
  @Matches(/^#[0-9a-fA-F]{6}$/)
  avatarColor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(6000)
  responsibilities?: string;

  @IsString()
  @MinLength(10)
  @MaxLength(6000)
  instruction: string;

  @IsOptional()
  @IsString()
  @MaxLength(6000)
  boundaries?: string;

  @IsOptional()
  @IsString()
  @MaxLength(6000)
  memory?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('all', { each: true })
  skillIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ConnectorAttachmentDto)
  connectors?: ConnectorAttachmentDto[];
}

export class UpdatePersonalAgentDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsString()
  @Matches(/^#[0-9a-fA-F]{6}$/)
  avatarColor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(6000)
  responsibilities?: string;

  @IsOptional()
  @IsString()
  @MinLength(10)
  @MaxLength(6000)
  instruction?: string;

  @IsOptional()
  @IsString()
  @MaxLength(6000)
  boundaries?: string;

  @IsOptional()
  @IsString()
  @MaxLength(6000)
  memory?: string;

  @IsOptional()
  @IsIn(['active', 'inactive'])
  status?: 'active' | 'inactive';

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('all', { each: true })
  skillIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ConnectorAttachmentDto)
  connectors?: ConnectorAttachmentDto[];
}

export class FromTemplateDto {
  @IsUUID()
  templateId: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;
}

export class SkillDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name: string;

  @IsString()
  @MinLength(5)
  @MaxLength(1000)
  description: string;

  @IsString()
  @MinLength(10)
  @MaxLength(8000)
  instructions: string;
}

export class UpdateSkillDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(5)
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsString()
  @MinLength(10)
  @MaxLength(8000)
  instructions?: string;
}

export const GROUP_MODES = ['delegate', 'discussion'] as const;

export class AgentGroupDto {
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsIn(GROUP_MODES)
  mode: (typeof GROUP_MODES)[number];

  @IsUUID()
  leaderAgentId: string;

  @IsArray()
  @ArrayMaxSize(8)
  @IsUUID('all', { each: true })
  memberAgentIds: string[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(6)
  maxRounds?: number;
}

export class AgentTaskDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(AI_LIMITS.maxTaskInstructionLength)
  instruction: string;

  @IsOptional()
  @IsUUID()
  agentId?: string;

  @IsOptional()
  @IsUUID()
  groupId?: string;

  @IsOptional()
  @IsBoolean()
  webSearch?: boolean;
}

export class TaskReplyDto {
  @IsString()
  @MinLength(1)
  @MaxLength(AI_LIMITS.maxPromptLength)
  message: string;
}

export class TaskApprovalDecisionDto {
  @IsIn(['approved', 'rejected'])
  decision: 'approved' | 'rejected';

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class TaskEventsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  afterEventId?: number;
}
