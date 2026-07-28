import { IsDateString, IsIn, IsString, MinLength } from 'class-validator';

export class CorrectAttendanceDto {
  @IsIn(['check_in', 'check_out'])
  type!: 'check_in' | 'check_out';

  @IsDateString()
  occurredAt!: string;

  @IsString()
  @MinLength(1, { message: 'A reason is required for manual corrections.' })
  reason!: string;
}
