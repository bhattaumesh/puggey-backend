import { IsIn, IsNumber, IsOptional, IsPositive, IsString, IsUUID } from 'class-validator';

export const OUTFLOW_PURPOSES = ['advance', 'employee_purchase', 'other'] as const;
export type OutflowPurpose = (typeof OUTFLOW_PURPOSES)[number];

export class AddCashMovementDto {
  @IsIn(['inflow', 'outflow', 'sales'])
  type!: 'inflow' | 'outflow' | 'sales';

  @IsNumber()
  @IsPositive()
  amount!: number;

  // Required unless the entry names an employee (advance / purchase), where
  // a sensible default is written -- enforced in CountersService.
  @IsOptional()
  @IsString()
  reason?: string;

  // Outflows only: what the money was for. 'advance' and 'employee_purchase'
  // also name the employee and are mirrored into that employee's advances so
  // payroll recovers them from net pay.
  @IsOptional()
  @IsIn(OUTFLOW_PURPOSES)
  purpose?: OutflowPurpose;

  @IsOptional()
  @IsUUID()
  employeeMembershipId?: string;

  // Advance payments only: recover it all at the next payslip (default) or
  // in fixed instalments.
  @IsOptional()
  @IsIn(['FULL', 'INSTALMENT'])
  recoveryMode?: 'FULL' | 'INSTALMENT';

  @IsOptional()
  @IsNumber()
  @IsPositive()
  instalmentAmount?: number;
}
