import { IsISO8601, IsOptional, IsString } from 'class-validator';

export class AssignRackDto {
  @IsString()
  membershipId!: string;

  @IsOptional()
  @IsISO8601()
  dueDate?: string;
}
