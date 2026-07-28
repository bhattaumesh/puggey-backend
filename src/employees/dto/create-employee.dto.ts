import { IsEmail, IsEnum, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';
import { TenantRole } from '@prisma/client';

// Super Admin sets a temporary password directly rather than a full email-invite
// flow -- the proper "admin invites, user sets their own password" flow from the
// spec needs the email provider wired up first (see EmailService); this is the
// pragmatic version until then.
export class CreateEmployeeDto {
  @IsString()
  @MinLength(1)
  fullName!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters.' })
  temporaryPassword!: string;

  @IsEnum(TenantRole)
  role!: TenantRole;

  @IsOptional()
  @IsString()
  designation?: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsUUID()
  supervisorMembershipId?: string;
}
