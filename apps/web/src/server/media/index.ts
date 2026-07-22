import { env } from "../../env";
import { LocalStorage, createStorageFromEnv, type StoragePort } from "./storage-port";

// Single construction point (mirrors createOtpSenderFromEnv). In dev/e2e this is
// LocalStorage; production sets MEDIA_STORAGE=bucket and injects a signer (D1).
export const storage: StoragePort = createStorageFromEnv({
  MEDIA_STORAGE: env.MEDIA_STORAGE,
  MEDIA_PUBLIC_BASE: env.MEDIA_PUBLIC_BASE,
});

/** The local upload route needs the concrete adapter to persist bytes; null in
 * bucket mode (those uploads go straight to the bucket, never through us). */
export const localMediaStore: LocalStorage | null =
  storage instanceof LocalStorage ? storage : null;
