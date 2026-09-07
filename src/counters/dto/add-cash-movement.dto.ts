import { IsIn, IsNumber, IsPositive, IsString, MinLength } from 'class-validator';

export class AddCashMovementDto {
  @IsIn(['inflow', 'outflow', 'sales'])
  type!: 'inflow' | 'outflow' | 'sales';

  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsString()
  @MinLength(1, { message: 'A reason is required.' })
  reason!: string;
}
