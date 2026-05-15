import { Module } from "@nestjs/common";
import { AspirantWardMeetingsService } from "./aspirant-ward-meetings.service";
import { AspirantWardMeetingsController } from "./aspirant-ward-meetings.controller";
import { WardsModule } from "../wards/wards.module";
import { AspirantsModule } from "../aspirants/aspirants.module";
import { UsersModule } from "../users/users.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { ElectionsModule } from "../elections/elections.module";

@Module({
  imports: [
    WardsModule,
    AspirantsModule,
    UsersModule,
    NotificationsModule,
    ElectionsModule,
  ],
  providers: [AspirantWardMeetingsService],
  controllers: [AspirantWardMeetingsController],
})
export class AspirantWardMeetingsModule {}
