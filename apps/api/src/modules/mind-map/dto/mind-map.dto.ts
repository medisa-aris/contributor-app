import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export const MIND_MAP_MODES = ['second_brain', 'counterpart', 'subordinate'] as const;
export type MindMapMode = (typeof MIND_MAP_MODES)[number];

export class MindMapQueryDto {
  /** Rentang waktu (hari ke belakang). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  days: number = 30;

  /** Daftar mode dipisah koma; kosong berarti semua mode. */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && value.length > 0 ? value.split(',') : undefined,
  )
  @IsIn(MIND_MAP_MODES, { each: true })
  modes?: MindMapMode[];

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value === 'true' || value === true)
  @IsBoolean()
  includeSelf: boolean = false;
}

export class TopicsQueryDto extends MindMapQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}
