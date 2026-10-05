import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsNumber, IsOptional, ValidateNested } from 'class-validator';

export class VerifyExportRowDto {
  @IsOptional()
  @IsNumber()
  software!: number | null;

  @IsOptional()
  @IsNumber()
  online!: number | null;
}

// The browser does the matching; this is just the finished table it wants
// as a file.
export class VerifyExportDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => VerifyExportRowDto)
  rows!: VerifyExportRowDto[];
}
