import { IsBoolean, IsHexColor, IsIn, IsOptional, IsString, IsUrl, MinLength } from 'class-validator';

export class UpdateTenantDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  // Racks/vendors/product-received are retail-specific; a non-retail tenant
  // turns this off to stop seeing that module's nav item and quick actions.
  @IsOptional()
  @IsBoolean()
  retailModulesEnabled?: boolean;

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
