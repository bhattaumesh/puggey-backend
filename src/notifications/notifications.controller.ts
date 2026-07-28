import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  async list() {
    const [items, unreadCount] = await Promise.all([this.notifications.list(), this.notifications.unreadCount()]);
    return { items, unreadCount };
  }

  @Post(':id/read')
  markRead(@Param('id') id: string) {
    return this.notifications.markRead(id);
  }

  @Post('read-all')
  markAllRead() {
    return this.notifications.markAllRead();
  }
}
