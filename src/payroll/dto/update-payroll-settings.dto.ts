import { IsNumber, Max, Min } from 'class-validator';

// Both rates are REQUIRES_VERIFICATION: the tenant's own admin is the one
// asserting these numbers, not Pugey. See PayrollSettings in schema.prisma.
export class UpdatePayrollSettingsDto {
  @IsNumber()
  @Min(0)
  @Max(100)
  incomeTaxPercent!: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  providentFundPercent!: number;
}
