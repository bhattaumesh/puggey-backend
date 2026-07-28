import { IsDateString, IsIn, IsNumber, IsOptional, IsPositive, IsString, IsUUID, ValidateIf } from 'class-validator';

// amount is deliberately not editable once any recovery has been applied --
// see AdvancesService.update.
export class UpdateAdvanceDto {
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  amount?: number;

  @IsOptional()
  @IsDateString()
  dateGiven?: string;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsIn(['FULL', 'INSTALMENT'])
  recoveryMode?: 'FULL' | 'INSTALMENT';

  @ValidateIf((o) => o.recoveryMode === 'INSTALMENT')
  @IsNumber()
  @IsPositive()
  instalmentAmount?: number;
}
