import { IsString, MinLength } from 'class-validator';

export class CreateCounterDto {
  @IsString()
  @MinLength(1)
  name!: string;
}
