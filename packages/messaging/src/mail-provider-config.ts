/**
 * WHICH MAIL PROVIDER THE SETTINGS SELECT — and nothing else.
 *
 * Split from mail-provider.ts because both tiers' `env.ts` need the answer at
 * boot, and an env module should stay a leaf: this file imports nothing, so
 * reading the settings never loads the signer, the transport or anything they
 * pull in.
 */

export type EmailProviderSetting = "auto" | "dev" | "http" | "resend" | "ses" | "zeptomail";

export type MailProviderName = "resend" | "ses" | "zeptomail";

export interface MailEnv {
  readonly EMAIL_PROVIDER?: EmailProviderSetting | undefined;
  readonly EMAIL_FROM?: string | undefined;
  readonly EMAIL_API_ENDPOINT?: string | undefined;
  readonly EMAIL_API_KEY?: string | undefined;
  readonly SES_REGION?: string | undefined;
  readonly SES_ACCESS_KEY_ID?: string | undefined;
  readonly SES_SECRET_ACCESS_KEY?: string | undefined;
  readonly SES_CONFIGURATION_SET?: string | undefined;
  readonly SES_FEEDBACK_ADDRESS?: string | undefined;
  readonly ZEPTOMAIL_API_KEY?: string | undefined;
  readonly ZEPTOMAIL_ENDPOINT?: string | undefined;
}

const set = (value: string | undefined): value is string => value !== undefined && value !== "";

export function resendConfigured(env: MailEnv): boolean {
  return set(env.EMAIL_API_ENDPOINT) && set(env.EMAIL_API_KEY) && set(env.EMAIL_FROM);
}

export function sesConfigured(env: MailEnv): boolean {
  return (
    set(env.SES_REGION) &&
    set(env.SES_ACCESS_KEY_ID) &&
    set(env.SES_SECRET_ACCESS_KEY) &&
    set(env.EMAIL_FROM)
  );
}

/**
 * ZeptoMail (Zoho CPaaS) needs only its Send Mail token and a From address:
 * the endpoint defaults to the India data centre (mail-provider.ts).
 */
export function zeptomailConfigured(env: MailEnv): boolean {
  return set(env.ZEPTOMAIL_API_KEY) && set(env.EMAIL_FROM);
}

/**
 * Which provider the settings select, or null for none.
 *
 *   · dev          — none, even with credentials (the e2e suite's switch).
 *   · ses          — SES, and only SES.
 *   · zeptomail    — ZeptoMail (Zoho CPaaS), and only ZeptoMail.
 *   · resend|http  — Resend (`http` is its historical name, kept so no
 *                    existing env file changes meaning).
 *   · auto         — Resend when configured (what `auto` always meant), else
 *                    SES when configured, else none. ZeptoMail is never
 *                    picked by `auto`: it is chosen by name, so adding its
 *                    token to an env file cannot silently change provider.
 *
 * Null never means "silently drop": each caller turns it into its own honest
 * fallback — the dev inbox, the file outbox, `"unconfigured"` — and a
 * production process refuses to boot on it (env.ts in both tiers).
 */
export function selectedProvider(env: MailEnv): MailProviderName | null {
  switch (env.EMAIL_PROVIDER ?? "auto") {
    case "dev":
      return null;
    case "ses":
      return sesConfigured(env) ? "ses" : null;
    case "zeptomail":
      return zeptomailConfigured(env) ? "zeptomail" : null;
    case "resend":
    case "http":
      return resendConfigured(env) ? "resend" : null;
    case "auto":
      if (resendConfigured(env)) return "resend";
      return sesConfigured(env) ? "ses" : null;
  }
}

/** Configured, and not switched to dev — what "a real mailer" means everywhere. */
export function mailerConfigured(env: MailEnv): boolean {
  return selectedProvider(env) !== null;
}
