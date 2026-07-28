import { IsOptional, IsString } from 'class-validator';

export class GoogleLoginDto {
  @IsString()
  idToken!: string;

  @IsOptional()
  @IsString()
  companyCode?: string;
}
