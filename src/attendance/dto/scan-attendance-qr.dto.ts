import { IsNumber, IsString, Max, Min, MinLength } from 'class-validator';

export class ScanAttendanceQrDto {
  @IsString()
  @MinLength(1)
  token!: string;

  @IsNumber()
  @Min(-90)
  @Max(90)
  lat!: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  lng!: number;
}
