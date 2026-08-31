import { env } from "../../env";
import { createMediaSigner } from "./s3-signer";
import {
  LocalStorage,
  createStorageFromEnv,
  type BucketConfig,
  type StoragePort,
} from "./storage-port";

// Single construction point (mirrors createOtpSenderFromEnv). Dev/e2e is
// LocalStorage; production sets MEDIA_STORAGE=bucket and this builds the
// SigV4 signer that D1 left pending — before PI-1 P5 the bucket branch threw
// at first import, so the "config requirement" was really a boot failure.
function bucketConfig(): BucketConfig | undefined {
  if (
    env.MEDIA_STORAGE !== "bucket" ||
    env.MEDIA_PUBLIC_BASE === undefined ||
    env.MEDIA_S3_ENDPOINT === undefined ||
    env.MEDIA_S3_REGION === undefined ||
    env.MEDIA_S3_BUCKET === undefined ||
    env.MEDIA_S3_ACCESS_KEY_ID === undefined ||
    env.MEDIA_S3_SECRET_ACCESS_KEY === undefined
  ) {
    // env.ts refuses MEDIA_STORAGE=bucket without the credential set, so a
    // running process cannot reach the port's own "no BucketConfig" throw.
    return undefined;
  }
  return {
    publicBase: env.MEDIA_PUBLIC_BASE,
    sign: createMediaSigner({
      endpoint: env.MEDIA_S3_ENDPOINT,
      region: env.MEDIA_S3_REGION,
      bucket: env.MEDIA_S3_BUCKET,
      accessKeyId: env.MEDIA_S3_ACCESS_KEY_ID,
      secretAccessKey: env.MEDIA_S3_SECRET_ACCESS_KEY,
    }),
  };
}

export const storage: StoragePort = createStorageFromEnv(
  {
    MEDIA_STORAGE: env.MEDIA_STORAGE,
    MEDIA_PUBLIC_BASE: env.MEDIA_PUBLIC_BASE,
  },
  bucketConfig(),
);

/** The local upload route needs the concrete adapter to persist bytes; null in
 * bucket mode (those uploads go straight to the bucket, never through us). */
export const localMediaStore: LocalStorage | null =
  storage instanceof LocalStorage ? storage : null;
