import { IsString, MinLength } from 'class-validator';

export class UpdateAdvanceCategoryDto {
  @IsString()
  @MinLength(1)
  name!: string;
}
