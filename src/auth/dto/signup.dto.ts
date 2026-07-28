import { IsEmail, IsString, Matches, MinLength } from 'class-validator';

export class SignUpDto {
  @IsString()
  @MinLength(2)
  companyName!: string;

  @IsString()
  @Matches(/^[a-z0-9-]{2,40}$/, { message: 'Slug must be lowercase letters, numbers, and hyphens only.' })
  slug!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters.' })
  password!: string;
}
