import { IsDateString, IsNumber, IsOptional, IsPositive, IsString, IsUUID, MinLength } from 'class-validator';

export class CreateBillDto {
  @IsOptional()
  @IsUUID()
  vendorId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  billNumber?: string;

  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsDateString()
  billDate!: string;

  @IsOptional()
  @IsString()
  remarks?: string;
}
