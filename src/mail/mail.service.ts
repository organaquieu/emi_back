import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;

  constructor(private readonly config: ConfigService) {}

  private getTransporter(): Transporter {
    if (this.transporter) return this.transporter;

    const host = this.config.get<string>('SMTP_HOST');
    const port = parseInt(this.config.get<string>('SMTP_PORT') ?? '587', 10);
    const user = this.config.get<string>('SMTP_USER');
    const pass = this.config.get<string>('SMTP_PASS');
    const secure = this.config.get<string>('SMTP_SECURE') === 'true';

    if (!host || !user || !pass) {
      throw new InternalServerErrorException('SMTP is not configured (SMTP_HOST, SMTP_USER, SMTP_PASS)');
    }

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass },
    });

    return this.transporter;
  }

  async sendRegistrationCode(to: string, code: string): Promise<void> {
    const from = this.config.get<string>('SMTP_FROM') ?? this.config.get<string>('SMTP_USER');
    const appName = this.config.get<string>('APP_NAME') ?? 'Emi';

    const subject = `${appName}: код подтверждения регистрации`;
    const text = `Ваш код подтверждения: ${code}\n\nКод действует 15 минут. Если вы не регистрировались — проигнорируйте это письмо.`;
    const html = `
      <p>Здравствуйте!</p>
      <p>Код для подтверждения регистрации в <strong>${appName}</strong>:</p>
      <p style="font-size:24px;font-weight:bold;letter-spacing:4px">${code}</p>
      <p>Код действует <strong>15 минут</strong>.</p>
      <p>Если вы не регистрировались — просто удалите это письмо.</p>
    `;

    const logOnly = this.config.get<string>('SMTP_LOG_ONLY') === 'true';
    if (logOnly) {
      this.logger.warn(`[SMTP_LOG_ONLY] Registration code for ${to}: ${code}`);
      return;
    }

    await this.getTransporter().sendMail({ from, to, subject, text, html });
  }
}
