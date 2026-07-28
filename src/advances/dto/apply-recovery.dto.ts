import { IsInt, Max, Min } from 'class-validator';

export class ApplyRecoveryDto {
  @IsInt()
  @Min(2020)
  @Max(2100)
  year!: number;

  @IsInt()
  @Min(1)
  @Max(12)
  month!: number;
}
