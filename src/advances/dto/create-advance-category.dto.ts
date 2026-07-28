import { IsString, MinLength } from 'class-validator';

export class CreateAdvanceCategoryDto {
  @IsString()
  @MinLength(1)
  name!: string;
}
