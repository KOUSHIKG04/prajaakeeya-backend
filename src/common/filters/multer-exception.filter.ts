import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
} from "@nestjs/common";
import type { Response } from "express";
import { MulterError } from "multer";
import { MAX_UPLOAD_BYTES } from "../upload.constants";

function humanKb(bytes: number) {
  return `${Math.round(bytes / 1024)} KB`;
}

/**
 * Replace multer's default error responses with payloads the frontend can
 * display verbatim. Specifically, oversize uploads return 413 with the
 * current limit in the message so the user knows what to aim for.
 */
@Catch(MulterError)
export class MulterExceptionFilter implements ExceptionFilter {
  catch(err: MulterError, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const limitLabel = humanKb(MAX_UPLOAD_BYTES);

    switch (err.code) {
      case "LIMIT_FILE_SIZE":
        return res.status(HttpStatus.PAYLOAD_TOO_LARGE).json({
          statusCode: HttpStatus.PAYLOAD_TOO_LARGE,
          error: "Payload Too Large",
          message: `File too large. Limit is upto ${limitLabel}. Please compress and upload.`,
          maxBytes: MAX_UPLOAD_BYTES,
          maxLabel: limitLabel,
        });

      case "LIMIT_FILE_COUNT":
        return res.status(HttpStatus.PAYLOAD_TOO_LARGE).json({
          statusCode: HttpStatus.PAYLOAD_TOO_LARGE,
          error: "Payload Too Large",
          message: "Too many files uploaded.",
        });

      case "LIMIT_UNEXPECTED_FILE":
        return res.status(HttpStatus.BAD_REQUEST).json({
          statusCode: HttpStatus.BAD_REQUEST,
          error: "Bad Request",
          message: `Unexpected file field "${err.field}".`,
        });

      default:
        return res.status(HttpStatus.BAD_REQUEST).json({
          statusCode: HttpStatus.BAD_REQUEST,
          error: "Bad Request",
          message: err.message || "File upload error.",
        });
    }
  }
}
