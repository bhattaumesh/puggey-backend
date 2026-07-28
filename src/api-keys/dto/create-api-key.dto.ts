import { IsString, MinLength } from 'class-validator';

export class CreateApiKeyDto {
  @IsString()
  @MinLength(1)
  name!: string;
}
