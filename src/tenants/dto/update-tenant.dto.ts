import { IsHexColor, IsIn, IsOptional, IsString, IsUrl, MinLength } from 'class-validator';

export class UpdateTenantDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsHexColor()
  accentColorHex?: string;

  @IsOptional()
  @IsUrl()
  logoUrl?: string;

  @IsOptional()
  @IsIn(['en', 'ne'])
  locale?: string;

  @IsOptional()
  @IsIn(['AD', 'BS'])
  calendarPreference?: string;
}
