import { IsNumber, IsObject, Min } from 'class-validator';

// Admin-only correction for the opening balance/last-sale reading a session
// started with -- see EditClosingDetailsDto for the employee-facing
// counterpart on the closing side.
export class EditOpeningDetailsDto {
  @IsObject()
  openingDenominations!: Record<string, number>;

  @IsNumber()
  @Min(0)
  previousSale!: number;
}
