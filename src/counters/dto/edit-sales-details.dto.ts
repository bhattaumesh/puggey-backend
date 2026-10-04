import { IsNumber, IsOptional, Min } from 'class-validator';

// Admin-only quick correction of just the sale readings, without redoing a
// whole denomination count the way editOpeningDetails/editClosingDetails
// require. Both optional so either reading can be fixed on its own.
export class EditSalesDetailsDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  previousSale?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  closingSale?: number;
}
