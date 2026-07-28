import { IsDateString, IsIn, IsNumber, IsOptional, IsPositive, IsString, IsUUID, ValidateIf } from 'class-validator';

export class CreateAdvanceDto {
  @IsUUID()
  membershipId!: string;

  @IsUUID()
  categoryId!: string;

  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsDateString()
  dateGiven!: string;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsIn(['FULL', 'INSTALMENT'])
  recoveryMode!: 'FULL' | 'INSTALMENT';

  @ValidateIf((o) => o.recoveryMode === 'INSTALMENT')
  @IsNumber()
  @IsPositive()
  instalmentAmount?: number;
}
