import { Controller, Post, Body, Req, Inject } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service.js';
import { ChangePasswordDto, LoginDto, RefreshDto, RegisterDto, SendRegistrationCodeDto } from './auth.dto.js';
import { Public } from '../common/decorators/public.decorator.js';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  @Public()
  @Post('register/send-code')
  @ApiBody({ type: () => SendRegistrationCodeDto })
  @ApiOperation({
    summary: 'Отправить 6-значный код на email (шаг 1 регистрации)',
    description: 'Код действует 15 минут. Повторная отправка — не чаще 1 раза в минуту.',
  })
  @ApiResponse({ status: 201 })
  sendRegistrationCode(@Body() dto: SendRegistrationCodeDto) {
    return this.authService.sendRegistrationCode(dto);
  }

  @Public()
  @Post('register')
  @ApiBody({ type: () => RegisterDto })
  @ApiOperation({
    summary: 'Завершить регистрацию (шаг 2)',
    description: 'Нужен код из письма после POST /auth/register/send-code.',
  })
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
