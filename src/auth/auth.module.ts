import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';
import { ApiKeyGuard } from './api-key.guard';

@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard, RolesGuard, ApiKeyGuard],
  exports: [AuthService, JwtAuthGuard, RolesGuard, ApiKeyGuard, JwtModule],
})
export class AuthModule {}
