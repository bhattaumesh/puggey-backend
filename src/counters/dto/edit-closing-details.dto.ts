import { IsNumber, IsObject, Min } from 'class-validator';

// Same shape as CloseCounterSessionDto -- lets whoever closed the till (or
// their assigner) correct a mistyped closing count/sale before it's been
// verified, without reopening the whole session.
export class EditClosingDetailsDto {
  @IsObject()
  closingDenominations!: Record<string, number>;

  @IsNumber()
  @Min(0)
  closingSale!: number;
}
