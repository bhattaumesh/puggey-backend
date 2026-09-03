import { IsEnum, IsNumber, Max, Min } from 'class-validator';
import { PayrollContributionScheme } from '@prisma/client';

// All three rates, and whether a contribution scheme applies at all, are
// REQUIRES_VERIFICATION: the tenant's own admin is the one asserting these
// numbers, not Pugey. See PayrollSettings in schema.prisma.
export class UpdatePayrollSettingsDto {
  @IsNumber()
  @Min(0)
  @Max(100)
  incomeTaxPercent!: number;

  @IsEnum(PayrollContributionScheme)
  contributionScheme!: PayrollContributionScheme;

  @IsNumber()
  @Min(0)
  @Max(100)
  employeeContributionPercent!: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  employerContributionPercent!: number;
}
