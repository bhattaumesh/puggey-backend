import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class VerifyCounterSessionDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  workRating?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  remarks?: string;
}
