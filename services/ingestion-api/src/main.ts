import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'node:path';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  configureApp(app);
  // The live fleet dashboard: a static page that talks to the REST API and SSE stream.
  app.useStaticAssets(join(__dirname, '..', 'public'));

  const port = app.get(ConfigService).get<number>('PORT', 3000);
  await app.listen(port);
  Logger.log(`Listening on :${port} (dashboard at /, API docs at /docs)`, 'Bootstrap');
}

void bootstrap();
