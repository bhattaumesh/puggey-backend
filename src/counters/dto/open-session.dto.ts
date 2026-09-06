import { IsObject, IsUUID } from 'class-validator';

// openingDenominations is a plain { "1000": 5, "500": 3, ... } map (note/coin
// value -> count) -- validated and totalled in the service, not here, since
// class-validator has no clean way to check a dynamic-key numeric map.
export class OpenCounterSessionDto {
  @IsUUID()
  membershipId!: string;

  @IsUUID()
  counterId!: string;

  @IsObject()
  openingDenominations!: Record<string, number>;
}
