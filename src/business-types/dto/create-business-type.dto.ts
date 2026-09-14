import { IsString, Matches, MinLength } from 'class-validator';

export class CreateBusinessTypeDto {
  @IsString()
  @Matches(/^[a-z0-9_]{2,40}$/, { message: 'Key must be lowercase letters, numbers, or underscores.' })
  key!: string;

  @IsString()
  @MinLength(1)
  label!: string;
}
