import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';


export enum RegisterRole {
  ALEXITHYMIC = 'ALEXITHYMIC',
  THERAPIST = 'THERAPIST',
  ADMIN = 'ADMIN',
}

export class RegisterDto {
  @ApiProperty({ type: String, format: 'email', example: 'user@example.com' })
  @IsEmail()
  email!: string;

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

