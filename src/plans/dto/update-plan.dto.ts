import { IsArray, IsIn, IsInt, IsOptional, IsPositive, IsString, MinLength } from 'class-validator';
import { FEATURE_KEYS } from '../feature-keys';

export class UpdatePlanDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  label?: string;

  // null explicitly clears the cap (unlimited); omitted leaves it unchanged.
  @IsOptional()
  @IsInt()
  @IsPositive()
  maxEmployees?: number | null;

  @IsOptional()
  @IsArray()
  @IsIn(FEATURE_KEYS, { each: true })
  features?: string[];
}
