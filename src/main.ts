import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as dotenv from 'dotenv';

dotenv.config();

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const port = Number(process.env.PORT) || 3000;

  await app.listen(port);
  console.log(`Listening on ${await app.getUrl()} (PORT=${process.env.PORT ?? ''})`);
}
bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
