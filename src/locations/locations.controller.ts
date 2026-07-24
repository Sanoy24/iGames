import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import { SetMyLocationDto } from './dto/set-my-location.dto';
import { LocationsService } from './locations.service';

@ApiTags('locations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('locations')
export class LocationsController {
  constructor(private readonly locationsService: LocationsService) {}

  /** The registration dropdown. Players pick one of these, or "Other". */
  @Get()
  list() {
    return this.locationsService.listPublicLocations();
  }

  /** Null when the player has never answered — the Mini App uses this to prompt. */
  @Get('me')
  getMine(@CurrentUser() user: AuthenticatedUser) {
    return this.locationsService.getUserLocation(user.id);
  }

  @Patch('me')
  setMine(@CurrentUser() user: AuthenticatedUser, @Body() dto: SetMyLocationDto) {
    return this.locationsService.setUserLocation(user.id, dto);
  }
}
