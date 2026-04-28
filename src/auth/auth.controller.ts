import { Controller, Post, Body, Req, Inject } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service.js';
import { ChangePasswordDto, LoginDto, RefreshDto, RegisterDto } from './auth.dto.js';
import { Public } from '../common/decorators/public.decorator.js';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  @ApiBody({ type: () => RegisterDto })
  @ApiOperation({ summary: 'Register user' })
  @ApiResponse({ status: 201 })
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Public()
  @Post('login')
  @ApiBody({ type: () => LoginDto })
  @ApiOperation({ summary: 'Login user' })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Public()
  @Post('refresh')
  @ApiBody({ type: () => RefreshDto })
  @ApiOperation({ summary: 'Refresh token' })
  refresh(@Body() dto: RefreshDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @ApiBearerAuth()
  @Post('logout')
  @ApiOperation({ summary: 'Logout user' })
  logout(@Req() req: any) {
    return this.authService.logout(req.user.sub);
  }

  @ApiBearerAuth()
  @Post('change-password')
  @ApiBody({ type: () => ChangePasswordDto })
  @ApiOperation({ summary: 'Change password' })
  changePassword(@Req() req: any, @Body() dto: ChangePasswordDto) {
    return this.authService.changePassword(req.user.sub, dto);
  }
}
