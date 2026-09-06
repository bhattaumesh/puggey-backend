import { IsObject } from 'class-validator';

export class CloseCounterSessionDto {
  @IsObject()
  closingDenominations!: Record<string, number>;
}
