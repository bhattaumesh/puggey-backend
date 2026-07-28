import { IsOptional, IsString } from 'class-validator';

export class CleanRackDto {
  @IsOptional()
  @IsString()
  remarks?: string;
}
