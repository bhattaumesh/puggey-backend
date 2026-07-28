import { Type } from 'class-transformer';
import { IsArray, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, Min, ValidateNested } from 'class-validator';

// Year covers both AD (e.g. 2026) and BS (e.g. 2083) since the period is
// stored as whichever calendar the tenant preferred at generation time --
// gross pay is the flat baseSalary, never attendance-date-derived, so no
// calendar conversion happens here, only labeling on display.
class ReceivableInputDto {
  @IsString()
  membershipId!: string;

  @IsNumber()
  @Min(0)
  amount!: number;
}

export class GeneratePayslipsDto {
  @IsInt()
  @Min(2000)
  @Max(2200)
  year!: number;

  @IsInt()
  @Min(1)
  @Max(12)
  month!: number;

  // Previous month's unpaid receivable per employee, added to salary after
  // tax deduction and before advance recovery. Optional and defaults to 0
  // for any member not listed.
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReceivableInputDto)
  receivables?: ReceivableInputDto[];

  // When set, generates/regenerates only this one employee's payslip for the
  // period instead of every active employee with a base salary -- the same
  // idempotent upsert either way, just scoped to one person so an admin can
  // create or correct a single payslip without touching everyone else's.
  @IsOptional()
  @IsUUID()
  membershipId?: string;
}
