import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AspirantMessage } from "./aspirant-message.entity";
import { Aspirant } from "./aspirant.entity";
import { AspirantChatService } from "./aspirant-chat.service";
import { AspirantChatController } from "./aspirant-chat.controller";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  imports: [
    TypeOrmModule.forFeature([AspirantMessage, Aspirant]),
    NotificationsModule,
  ],
  providers: [AspirantChatService],
  controllers: [AspirantChatController],
  exports: [AspirantChatService],
})
export class AspirantChatModule {}
