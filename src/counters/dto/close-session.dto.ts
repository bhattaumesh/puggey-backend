import { IsNumber, IsObject, Min } from 'class-validator';

export class CloseCounterSessionDto {
  @IsObject()
  closingDenominations!: Record<string, number>;

  // The counter's running sales-total reading at handover -- paired with
  // the session's previousSale to compute total sales for the shift.
  @IsNumber()
  @Min(0)
  closingSale!: number;
}
