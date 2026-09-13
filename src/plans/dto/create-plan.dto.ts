import { IsArray, IsIn, IsInt, IsOptional, IsPositive, IsString, Matches, MinLength } from 'class-validator';
import { FEATURE_KEYS } from '../feature-keys';

export class CreatePlanDto {
  @IsString()
  @Matches(/^[a-z0-9_]{2,40}$/, { message: 'Key must be lowercase letters, numbers, or underscores.' })
  key!: string;

  @IsString()
  @MinLength(1)
  label!: string;

  // Omitted or null = unlimited employees.
  @IsOptional()
  @IsInt()
  @IsPositive()
  maxEmployees?: number;

  @IsArray()
  @IsIn(FEATURE_KEYS, { each: true })
  features!: string[];
}
