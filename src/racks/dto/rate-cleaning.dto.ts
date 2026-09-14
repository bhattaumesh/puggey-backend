import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class RateCleaningDto {
  @IsInt()
  @Min(1)
  @Max(5)
  qualityRating!: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  remarks?: string;
}
