import { IsString, MinLength } from 'class-validator';

export class UpdateCounterDto {
  @IsString()
  @MinLength(1)
  name!: string;
}
