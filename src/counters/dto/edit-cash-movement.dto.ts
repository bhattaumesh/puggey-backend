import { IsNumber, IsPositive, IsString, MinLength } from 'class-validator';

export class EditCashMovementDto {
  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsString()
  @MinLength(1, { message: 'A reason is required.' })
  reason!: string;
}
