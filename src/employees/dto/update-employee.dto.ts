import { IsDateString, IsNumber, IsOptional, IsString, IsUUID, IsUrl, Min, MinLength, ValidateIf } from 'class-validator';
import { Transform } from 'class-transformer';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class UpdateEmployeeDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  fullName?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  designation?: string;

  @IsOptional()
  @IsString()
  employeeCode?: string;

  // The edit form always sends the current value, including '' when no photo
  // is set -- @IsOptional() alone only skips undefined/null, not ''.
  @IsOptional()
  @ValidateIf((o) => !!o.photoUrl)
  @IsUrl()
  photoUrl?: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsUUID()
  supervisorMembershipId?: string;

  // Route is already restricted to Super Admin only.
  @IsOptional()
  @IsNumber()
  @Min(0)
  baseSalary?: number;

  // --- Bio-data ---
  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @IsOptional() @IsString() @Transform(trim) fatherName?: string;
  @IsOptional() @IsString() @Transform(trim) motherName?: string;
  @IsOptional() @IsString() @Transform(trim) grandfatherName?: string;

  // --- Background ---
  @IsOptional() @IsString() education?: string;
  @IsOptional() @IsString() pastExperience?: string;

  // --- Contact ---
  @IsOptional() @IsString() currentAddress?: string;
  @IsOptional() @IsString() permanentAddress?: string;
  @IsOptional() @IsString() @Transform(trim) mobileNumber?: string;
  @IsOptional() @IsString() @Transform(trim) emergencyContactNumber?: string;

  // --- Identity numbers ---
  // Deliberately no format validation: Nepali document number formats vary
  // (leading zeros, mixed separators), and a strict pattern would reject
  // valid numbers. Trim whitespace only, per spec.
  @IsOptional() @IsString() @Transform(trim) citizenshipNumber?: string;
  @IsOptional() @IsString() @Transform(trim) panNumber?: string;
  @IsOptional() @IsString() @Transform(trim) nidNumber?: string;
  @IsOptional() @IsString() @Transform(trim) drivingLicenceNumber?: string;
}
