import { IsOptional, IsString, Matches, MinLength } from 'class-validator';

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export class UpdateShiftDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @Matches(HHMM, { message: 'startTime must be in HH:mm 24-hour format.' })
  startTime?: string;

  @IsOptional()
  @Matches(HHMM, { message: 'endTime must be in HH:mm 24-hour format.' })
  endTime?: string;
}
