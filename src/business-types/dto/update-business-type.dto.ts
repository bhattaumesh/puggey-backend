import { IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateBusinessTypeDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  label?: string;
}
