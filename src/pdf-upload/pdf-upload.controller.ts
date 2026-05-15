import {
  Controller,
  Param,
  Post,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiConsumes,
  ApiBody,
} from "@nestjs/swagger";
import { diskStorage } from "multer";
import { FilesInterceptor } from "@nestjs/platform-express";
import { mkdirSync } from "fs";
import { join } from "path";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import type { Request } from "express";
import { ExtractionService } from "../extraction/extraction.service";
import { MAX_UPLOAD_BYTES } from "../common/upload.constants";

@ApiTags("PDF Upload")
@Controller("wards")
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class PdfUploadController {
  constructor(private readonly extractionService: ExtractionService) {}

  @Post(":wardId/upload-pdfs")
  @ApiOperation({ summary: "Upload PDF files for a ward" })
  @ApiParam({
    name: "wardId",
    type: "number",
    description: "Ward ID",
    example: 1,
  })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        files: {
          type: "array",
          items: {
            type: "string",
            format: "binary",
          },
        },
      },
    },
  })
  @ApiResponse({ status: 201, description: "PDFs uploaded successfully" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  @UseInterceptors(
    FilesInterceptor("files", 20, {
      storage: diskStorage({
        destination: (
          req: Request,
          _file: Express.Multer.File,
          cb: (error: Error | null, destination: string) => void,
        ) => {
          const wardId = req.params.wardId;
          const dest = join(process.cwd(), "uploads", `ward-${wardId}`);
          mkdirSync(dest, { recursive: true });
          cb(null, dest);
        },
        filename: (
          _req: Request,
          file: Express.Multer.File,
          cb: (error: Error | null, filename: string) => void,
        ) => cb(null, `${Date.now()}-${file.originalname}`),
      }),
      limits: { fileSize: MAX_UPLOAD_BYTES },
    }),
  )
  async upload(
    @Param("wardId") wardId: number,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    const response = { wardId, files: files.map((file) => file.filename) };
    if (files.length > 0) {
      await this.extractionService.trigger(Number(wardId));
    }
    return response;
  }
}
