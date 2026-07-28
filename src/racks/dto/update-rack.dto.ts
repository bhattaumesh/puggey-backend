import { IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateRackDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  location?: string;
}
