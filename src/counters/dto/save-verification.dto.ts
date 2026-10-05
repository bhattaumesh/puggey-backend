import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsOptional, IsString, Matches, MaxLength, ValidateNested } from 'class-validator';
import { VerifyExportRowDto } from './verify-export.dto';

// A finished "Verify Online Transaction" table the user wants to keep.
export class SaveVerificationDto {
  // YYYY-MM-DD: the business day the transactions belong to.
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'reportDate must be a date (YYYY-MM-DD).' })
  reportDate!: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(200)
  note?: string;

  @IsOptional()
  @IsBoolean()
  ignoreOrder?: boolean;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => VerifyExportRowDto)
  rows!: VerifyExportRowDto[];
}
