import { IsInt, IsString, Min, MinLength } from 'class-validator';

export class CreateLeaveTypeDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsInt()
  @Min(0)
  defaultDaysPerYear!: number;
}
