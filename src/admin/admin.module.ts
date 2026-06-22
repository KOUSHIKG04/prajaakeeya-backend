import { Module } from "@nestjs/common";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";
import { WardsModule } from "../wards/wards.module";
import { AspirantsModule } from "../aspirants/aspirants.module";
import { VotesModule } from "../votes/votes.module";
import { UsersModule } from "../users/users.module";
import { ElectionsModule } from "../elections/elections.module";
import { GeographyModule } from "../geography/geography.module";
import { GramaPanchayatModule } from "../grama-panchayat/grama-panchayat.module";

@Module({
  imports: [
    WardsModule,
    AspirantsModule,
    VotesModule,
    UsersModule,
    ElectionsModule,
    GeographyModule,
    GramaPanchayatModule,
  ],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
