import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const payload = exception instanceof HttpException ? exception.getResponse() : { message: 'Internal server error', error: 'InternalServerError' };

    if (!(exception instanceof HttpException)) {
      const msg = exception instanceof Error ? exception.message : String(exception);
      this.logger.error(msg, exception instanceof Error ? exception.stack : undefined);
    }

    const isProd = process.env.NODE_ENV === 'production';
    const body: Record<string, unknown> = {
      statusCode: status,
      ...(typeof payload === 'object' ? payload : { message: payload }),
      timestamp: new Date().toISOString(),
    };
    if (!isProd && !(exception instanceof HttpException) && exception instanceof Error) {
      body.detail = exception.message;
      body.name = exception.name;
    }

    response.status(status).json(body);
  }
}
