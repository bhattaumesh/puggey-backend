import { IsOptional, IsString } from 'class-validator';

// productId omitted or null clears the tag -- an employee correcting a
// receipt they logged without knowing the product yet, or realizing they
// picked the wrong one.
export class UpdateReceiptProductDto {
  @IsOptional()
  @IsString()
  productId?: string | null;
}
