import { IsBoolean } from 'class-validator';

export class UpdateDelegationDto {
  @IsBoolean()
  active!: boolean;
}
