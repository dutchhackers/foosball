import { ApiCommonModule, DataMartService, MatchService, PlayerService, StatsService } from '@foosball/api/common';
import { CoreModule } from '@foosball/api/core';
import { DataModule } from '@foosball/api/data';
import { Module } from '@nestjs/common';

import { WebhookController } from './controllers/webhook.controller';

@Module({
  imports: [DataModule, CoreModule, ApiCommonModule],
  controllers: [WebhookController],
  providers: [PlayerService, MatchService, StatsService, DataMartService],
})
export class AppModule {}
