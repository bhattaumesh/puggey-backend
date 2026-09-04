import { IsInt, Max, Min } from 'class-validator';

export class RateCleaningDto {
  @IsInt()
  @Min(1)
  @Max(5)
  qualityRating!: number;
}
