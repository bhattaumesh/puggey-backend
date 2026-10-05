import { Transform } from 'class-transformer';
import { IsIn, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export const EXIT_TYPES = ['resigned', 'terminated', 'contract_ended', 'retired', 'other'] as const;
export type ExitType = (typeof EXIT_TYPES)[number];

// Switching an employee off when they leave the organisation. The remarks are
// required on purpose: the "Old employees" list is the only record of why
// someone left, so a blank reason is never useful.
export class DeactivateEmployeeDto {
  // YYYY-MM-DD, the last calendar day the person worked.
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'lastWorkingDay must be a date (YYYY-MM-DD).' })
  lastWorkingDay!: string;

  @IsIn(EXIT_TYPES)
  exitType!: ExitType;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1, { message: 'Add remarks about why this employee is leaving.' })
  @MaxLength(2000)
  remarks!: string;
}
