import { Module } from '@nestjs/common';
import { ChatGateway } from './chat.gateway';
import { RedisService } from './redis.service';

@Module({
  imports: [],
  controllers: [],
  providers: [ChatGateway, RedisService],
})
export class AppModule {}
