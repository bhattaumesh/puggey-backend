import { IsDateString, IsString, IsUUID, MinLength } from 'class-validator';

export class SubmitLeaveRequestDto {
  @IsUUID()
  leaveTypeId!: string;

  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;

  @IsString()
  @MinLength(1, { message: 'A reason is required.' })
  reason!: string;
}
