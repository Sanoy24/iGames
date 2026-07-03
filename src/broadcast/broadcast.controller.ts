import { mkdirSync } from 'fs';
import { extname } from 'path';
import { randomUUID } from 'crypto';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UnsupportedMediaTypeException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { SkipThrottle } from '@nestjs/throttler';
import { diskStorage } from 'multer';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import { AdminAuditInterceptor } from '../admin/admin-audit.interceptor';
import { BroadcastService } from './broadcast.service';
import { CreateBroadcastDto } from './dto/create-broadcast.dto';
import { BROADCAST_IMAGE_DIR, BROADCAST_IMAGE_SUBDIR } from './broadcast.constants';

/** Minimal shape of a multer file (avoids depending on @types/multer). */
type UploadedImage = { filename: string; mimetype: string; size: number };

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

@SkipThrottle()
@Controller('admin/broadcasts')
@UseGuards(JwtAuthGuard, RolesGuard)
@UseInterceptors(AdminAuditInterceptor)
@Roles('admin')
export class BroadcastController {
  constructor(private readonly broadcastService: BroadcastService) {}

  @Get()
  list() {
    return this.broadcastService.list();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.broadcastService.get(id);
  }

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('image', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          mkdirSync(BROADCAST_IMAGE_DIR, { recursive: true });
          cb(null, BROADCAST_IMAGE_DIR);
        },
        filename: (_req, file, cb) => {
          const ext = extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '') || '.jpg';
          cb(null, `${randomUUID()}${ext}`);
        },
      }),
      limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
      fileFilter: (_req, file, cb) => {
        if (!ALLOWED_IMAGE_TYPES.includes(file.mimetype)) {
          cb(new UnsupportedMediaTypeException('Only JPEG, PNG, WEBP or GIF images are allowed'), false);
          return;
        }
        cb(null, true);
      },
    }),
  )
  uploadImage(@UploadedFile() file?: UploadedImage) {
    if (!file) throw new BadRequestException('No image uploaded');
    return {
      imageFilename: file.filename,
      imagePath: `${BROADCAST_IMAGE_SUBDIR}/${file.filename}`,
    };
  }

  @Post()
  create(@Body() dto: CreateBroadcastDto, @CurrentUser() admin: AuthenticatedUser) {
    return this.broadcastService.create(dto, admin.id);
  }

  @Post(':id/send')
  sendNow(@Param('id') id: string) {
    return this.broadcastService.sendNow(id);
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string) {
    return this.broadcastService.cancel(id);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.broadcastService.remove(id);
  }
}
