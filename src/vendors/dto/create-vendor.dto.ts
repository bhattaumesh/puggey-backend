import { IsString, MinLength } from 'class-validator';

export class CreateVendorDto {
  @IsString()
  @MinLength(1)
  name!: string;
}
