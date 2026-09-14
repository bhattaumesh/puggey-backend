import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

// Shared by every "rate a completed piece of work" endpoint -- rack
// cleaning, product-received logs, bills entered -- so the same 1-5 score
// plus optional remark validation isn't redefined per module.
export class RateWorkDto {
  @IsInt()
  @Min(1)
  @Max(5)
  qualityRating!: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  remarks?: string;
}
