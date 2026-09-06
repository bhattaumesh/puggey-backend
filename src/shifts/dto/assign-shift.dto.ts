import { IsDateString, IsUUID } from 'class-validator';

export class AssignShiftDto {
  @IsUUID()
  membershipId!: string;

  @IsUUID()
  shiftId!: string;

  @IsDateString()
  date!: string;
}
