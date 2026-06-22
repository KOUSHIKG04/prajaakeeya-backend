import {
  Module,
  Global,
  forwardRef,
  BadRequestException,
} from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ConfigModule } from "@nestjs/config";
import { MulterModule } from "@nestjs/platform-express";

// Renderable types (HTML, SVG, JS, ...) served from the asset/CDN origin are a
// stored-XSS vector, so uploads are restricted to this allowlist of inert
// image/PDF types. Note: image/svg+xml is deliberately excluded — SVG can carry
// script.
const ALLOWED_UPLOAD_MIMETYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
];
import { MediaController } from "./controllers/media.controller";
import { MediaService } from "./services/media.service";
import { S3Service } from "./services/s3.service";
import { User } from "../users/user.entity";
import { Aspirant } from "../aspirants/aspirant.entity";
import { AdminDocument } from "../admin/admin-document.entity";
import { UserSignedDocument } from "../users/user-signed-document.entity";
import { MAX_UPLOAD_BYTES } from "./upload.constants";
import { AspirantsModule } from "../aspirants/aspirants.module";

@Global()
@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([
      User,
      Aspirant,
      AdminDocument,
      UserSignedDocument,
    ]),
    MulterModule.register({
      limits: {
        fileSize: MAX_UPLOAD_BYTES,
      },
      fileFilter: (
        _req: unknown,
        file: { mimetype: string },
        cb: (error: Error | null, acceptFile: boolean) => void,
      ) => {
        if (!ALLOWED_UPLOAD_MIMETYPES.includes(file.mimetype)) {
          return cb(
            new BadRequestException(
              `Unsupported file type: ${file.mimetype}. Allowed: ${ALLOWED_UPLOAD_MIMETYPES.join(", ")}`,
            ),
            false,
          );
        }
        cb(null, true);
      },
    }),
    forwardRef(() => AspirantsModule),
  ],
  controllers: [MediaController],
  providers: [MediaService, S3Service],
  exports: [MediaService, S3Service],
})
export class MediaModule {}
