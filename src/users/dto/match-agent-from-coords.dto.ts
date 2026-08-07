import { IsLatitude, IsLongitude } from 'class-validator';

export class MatchAgentFromCoordsDto {
  @IsLatitude()
  latitude: number;

  @IsLongitude()
  longitude: number;
}
