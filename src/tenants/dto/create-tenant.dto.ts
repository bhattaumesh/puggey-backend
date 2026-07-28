import { IsEmail, IsHexColor, IsOptional, IsString, Matches, MinLength } from 'class-validator';

export class CreateTenantDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsString()
  @Matches(/^[a-z0-9-]{2,40}$/, { message: 'Slug must be lowercase letters, numbers, and hyphens only.' })
  slug!: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9-]{2,20}$/)
  companyCode?: string;

  @IsOptional()
  @IsHexColor()
  accentColorHex?: string;

  @IsEmail()
  adminEmail!: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters.' })
  adminPassword!: string;
}
