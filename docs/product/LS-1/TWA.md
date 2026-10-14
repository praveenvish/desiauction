# Android app wrapper

C45 serves `/.well-known/assetlinks.json` from validated `TWA_PACKAGE_NAME` (default `in.desiauction.app`) and comma-separated `TWA_SHA256_FINGERPRINTS`. Each certificate is 32 colon-separated SHA-256 bytes. Unset certificates return 404 and production preflight warns.

Use [Bubblewrap's official CLI](https://github.com/GoogleChromeLabs/bubblewrap/blob/main/packages/cli/README.md) in a separate Android workspace, outside this repository's dependency tree:

```sh
npm install -g @bubblewrap/cli
bubblewrap init --manifest=https://YOUR_PUBLIC_HOST/manifest.webmanifest
bubblewrap build
```

Choose the configured Android package during initialization. Keep the upload keystore and passwords outside Git. The build produces a signed testing APK and an Android App Bundle for the Play Console.

For Play releases, use the **app signing certificate** SHA-256 from Play Console, rather than assuming the local upload certificate is the deployed signer. Configure all active app signing certificates in the web service environment, deploy, and verify the HTTPS asset-links endpoint returns the exact package and fingerprints. Test the Play-signed app: a verified Trusted Web Activity opens without the browser address bar. See [Chrome's signing and Digital Asset Links guide](https://developer.chrome.com/docs/android/trusted-web-activity/quick-start).

Publishing the wrapper and supplying real signing certificates remain operator steps. This execution creates no Play listing or release.
