import { IsOptional, IsString } from 'class-validator';

export class ReceiveProductDto {
  @IsOptional()
  @IsString()
  remarks?: string;

  @IsOptional()
  @IsString()
  productId?: string;

  @IsOptional()
  @IsString()
  billNumber?: string;
}
