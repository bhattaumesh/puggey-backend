import { IsDateString, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class CreateTaskDto {
  @IsUUID()
  membershipId!: string;

  @IsString()
  @MinLength(1)
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;
}
