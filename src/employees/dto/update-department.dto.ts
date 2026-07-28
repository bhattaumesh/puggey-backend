import { IsString, MinLength } from 'class-validator';

export class UpdateDepartmentDto {
  @IsString()
  @MinLength(1)
  name!: string;
}
