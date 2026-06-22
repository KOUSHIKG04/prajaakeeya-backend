// Sentry must be initialised BEFORE any other module is imported, so this file
// is imported on the very first line of main.ts.
//
// We load .env here directly with dotenv because `instrument` runs BEFORE Nest's
// ConfigModule has loaded it — otherwise SENTRY_DSN from the .env file wouldn't
// be visible yet. (Shell-exported vars work without this; the .env file needs it.)
//
// No-op when SENTRY_DSN is not set (enabled: false): local dev and any
// credential-less environment are unaffected — nothing is sent anywhere.
import * as dotenv from "dotenv";
import * as Sentry from "@sentry/nestjs";

dotenv.config();

const dsn = process.env.SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  environment: process.env.NODE_ENV || "development",
  // Do NOT attach request IP + user context to events. This is a voter-facing
  // political app, so voter IPs/PII must not be shipped to a third party.
  sendDefaultPii: false,
  // Fraction of requests sampled for performance tracing (0 = errors only).
  tracesSampleRate: process.env.SENTRY_TRACES_SAMPLE_RATE
    ? Number(process.env.SENTRY_TRACES_SAMPLE_RATE)
    : 0.1,
});
