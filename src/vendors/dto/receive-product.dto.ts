import { IsOptional, IsString } from 'class-validator';

export class ReceiveProductDto {
  @IsOptional()
  @IsString()
  remarks?: string;
}
