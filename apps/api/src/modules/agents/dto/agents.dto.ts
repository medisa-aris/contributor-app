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
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export const AGENT_STATUSES = ['active', 'inactive'] as const;

export class CreateAgentDto {
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

  @IsString()
  @MinLength(10)
  @MaxLength(20_000)
  instruction: string;

  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  toolAllowlist: string[];

  @IsBoolean()
  requireApproval: boolean;
}

export class UpdateAgentDto {
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
  @IsString()
  @MinLength(10)
  @MaxLength(20_000)
  instruction?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  toolAllowlist?: string[];

  @IsOptional()
  @IsBoolean()
  requireApproval?: boolean;

  @IsOptional()
  @IsIn(AGENT_STATUSES)
  status?: (typeof AGENT_STATUSES)[number];
}

export class ExecuteAgentDto {
  @IsString()
  @MinLength(5)
  @MaxLength(5000)
  instruction: string;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title?: string;
}

export class DecideApprovalDto {
  @IsIn(['approved', 'rejected'])
  decision: 'approved' | 'rejected';

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class ApprovalsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(['pending', 'approved', 'rejected'])
  status?: string;
}

export class AgentTasksQueryDto {
  @IsOptional()
  @IsIn(['created', 'validating', 'awaiting_approval', 'running', 'completed', 'failed', 'cancelled'])
  status?: string;

  @IsOptional()
  @IsUUID('4')
  agentId?: string;

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
