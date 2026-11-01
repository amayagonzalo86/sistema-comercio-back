import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PersonsModule } from '../persons/persons.module';
import { CardPlansModule } from '../sales/card-plans/card-plans.module';
import { SalesModule } from '../sales/sales.module';
import { AiSalesAgent } from './agent/ai-sales.agent';
import { AiSalesToolbox } from './agent/ai-sales.tools';
import { AiSalesController } from './ai-sales.controller';
import { AiSalesService } from './ai-sales.service';
import { AiConversationEntity, AiMessageEntity, AiSalesSettingsEntity } from './entities/ai-sales.entities';
import { AI_PROVIDERS, AiRouter, providersFromEnv } from './providers/ai-router';
import { HttpWhatsAppClient, WHATSAPP_CLIENT } from './whatsapp/whatsapp.client';
import { WhatsAppWebhookController } from './whatsapp/whatsapp-webhook.controller';

/** Vendedor IA por WhatsApp (módulo premium AI_SALES). */
@Module({
  imports: [TypeOrmModule.forFeature([AiSalesSettingsEntity, AiConversationEntity, AiMessageEntity]), SalesModule, CardPlansModule, PersonsModule],
  controllers: [AiSalesController, WhatsAppWebhookController],
  providers: [
    AiSalesService,
    AiSalesAgent,
    AiSalesToolbox,
    AiRouter,
    { provide: AI_PROVIDERS, useFactory: () => providersFromEnv() },
    { provide: WHATSAPP_CLIENT, useClass: HttpWhatsAppClient },
  ],
})
export class AiSalesModule {}
