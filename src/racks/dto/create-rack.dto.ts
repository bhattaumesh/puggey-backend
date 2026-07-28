import { IsOptional, IsString, MinLength } from 'class-validator';

export class CreateRackDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  location?: string;
}
