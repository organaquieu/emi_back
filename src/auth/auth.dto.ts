import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsOptional, IsString, Matches, MinLength } from 'class-validator';


export enum RegisterRole {
  ALEXITHYMIC = 'ALEXITHYMIC',
  THERAPIST = 'THERAPIST',
  ADMIN = 'ADMIN',
}

export class SendRegistrationCodeDto {
  @ApiProperty({ type: String, format: 'email', example: 'user@example.com' })
  @IsEmail()
  email!: string;
}

export class RegisterDto {
  @ApiProperty({ type: String, format: 'email', example: 'user@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({
    type: String,
    description: '6-значный код из письма (сначала POST /auth/register/send-code)',
    example: '482913',
  })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'code must be exactly 6 digits' })
  code!: string;

  @ApiProperty({ type: String, minLength: 8, example: 'SecurePass1!' })
  @MinLength(8)
  password!: string;

  @ApiProperty({ enum: RegisterRole, example: RegisterRole.ALEXITHYMIC })
  @IsEnum(RegisterRole)
  role!: RegisterRole;

  @ApiPropertyOptional({ type: String, example: 'Dr. Smith' })
  @IsOptional()
  @IsString()
  fullName?: string;
}

export class LoginDto {
  @ApiProperty({ type: String, format: 'email', example: 'user@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ type: String, format: 'password' })
  @IsString()
  password!: string;
}

export class RefreshDto {
  @ApiProperty({ type: String })
  @IsString()
  refreshToken!: string;
}

export class ChangePasswordDto {
  @ApiProperty({ type: String, format: 'password' })
  @IsString()
  currentPassword!: string;

  @ApiProperty({ type: String, minLength: 8, format: 'password' })
  @MinLength(8)
  newPassword!: string;
}

export class SendForgotPasswordCodeDto {
  @ApiProperty({ type: String, format: 'email', example: 'user@example.com' })
  @IsEmail()
  email!: string;
}

export class ResetPasswordDto {
  @ApiProperty({ type: String, format: 'email', example: 'user@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({
    type: String,
    description: '6-значный код из письма (после POST /auth/forgot-password/send-code)',
    example: '482913',
  })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'code must be exactly 6 digits' })
  code!: string;

  @ApiProperty({ type: String, minLength: 8, example: 'NewSecurePass1!' })
  @MinLength(8)
  newPassword!: string;

  @ApiProperty({ type: String, minLength: 8, example: 'NewSecurePass1!' })
  @MinLength(8)
  confirmPassword!: string;
}

