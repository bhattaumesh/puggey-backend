import { IsDateString, IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';

// Fills in the details a draft bill (created from a product receipt's bill
// number) doesn't have yet -- the point of "entering" it.
export class EnterBillDto {
  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsDateString()
  billDate!: string;

  @IsOptional()
  @IsString()
  remarks?: string;
}
