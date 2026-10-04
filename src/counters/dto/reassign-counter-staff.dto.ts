import { IsUUID } from 'class-validator';

export class ReassignCounterStaffDto {
  @IsUUID()
  membershipId!: string;
}
