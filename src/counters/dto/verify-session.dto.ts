import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class VerifyCounterSessionDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  workRating?: number;
}
