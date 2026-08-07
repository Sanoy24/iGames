import {
    Body,
    Controller,
    Get,
    HttpCode,
    HttpStatus,
    Patch,
    Post,
    UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import { SetAssignedAgentDto } from './dto/set-assigned-agent.dto';
import { MatchAgentFromCoordsDto } from './dto/match-agent-from-coords.dto';
import { UsersService } from './users.service';

/**
 * Direct player→agent GPS matching  replaces the old Location-catalog
 * onboarding step. A player is connected to the nearest currently on-duty
 * agent by proximity to that agent's own shared pin, with no admin-curated
 * area catalog involved.
 */
@ApiTags('agent-match')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('agent-match')
export class AgentMatchController {
    constructor(private readonly usersService: UsersService) {}

    /** On-duty agents, for the "pick from list" fallback. */
    @Get('agents')
    listAgents() {
        return this.usersService.listOnDutyAgentsForMatching();
    }

    /** Null when the player has never answered  the client uses this to prompt. */
    @Get('me')
    getMine(@CurrentUser() user: AuthenticatedUser) {
        return this.usersService.getAssignedAgent(user.id);
    }

    @Patch('me')
    setMine(
        @CurrentUser() user: AuthenticatedUser,
        @Body() dto: SetAssignedAgentDto,
    ) {
        return this.usersService.setAssignedAgent(user.id, dto);
    }

    /** GPS attempt: matches AND persists on hit; returns null (no write) on miss. */
    @Post('attempt')
    @HttpCode(HttpStatus.OK)
    async attempt(
        @CurrentUser() user: AuthenticatedUser,
        @Body() dto: MatchAgentFromCoordsDto,
    ) {
        const match = await this.usersService.matchAgentFromCoords(
            dto.latitude,
            dto.longitude,
        );
        if (!match) return null;
        return this.usersService.setAssignedAgent(
            user.id,
            { agentId: match.id },
            'gps_match',
        );
    }
}
