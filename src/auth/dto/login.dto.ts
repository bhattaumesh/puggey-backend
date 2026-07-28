import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  password!: string;

  // Fallback disambiguator when one email belongs to multiple tenants, or when
  // a company shares an email domain with others. Accepts the tenant slug.
  @IsOptional()
  @IsString()
  companyCode?: string;
}
