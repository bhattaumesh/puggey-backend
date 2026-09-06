import { IsIn, IsNumber, IsPositive, IsString, MinLength } from 'class-validator';

export class AddCashMovementDto {
  @IsIn(['inflow', 'outflow'])
  type!: 'inflow' | 'outflow';

  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsString()
  @MinLength(1, { message: 'A reason is required.' })
  reason!: string;
}
