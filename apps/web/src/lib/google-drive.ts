/**
 * GET A FORM'S PHOTOS FROM THE ORGANIZER'S GOOGLE DRIVE, IN THEIR BROWSER.
 *
 * Three steps, all against Google directly — nothing passes through our
 * servers, and nothing is kept:
 *
 *   1. SIGN-IN. Google Identity Services asks for `drive.file` — the narrowest
 *      Drive permission there is: access to the files the person picks, and no
 *      others. The token lives in this page for about an hour and is never
 *      sent to us or stored.
 *   2. PICK. Google's own Picker opens showing ONLY the photos the imported
 *      form linked (their file ids), so "select all" is the whole task.
 *      Picking is what grants access; the app id ties the grant to us.
 *   3. DOWNLOAD. Each picked file's bytes, from the Drive API, with the token.
 *
 * The scripts are Google's loaders, inserted by our trusted bundle (the CSP's
 * 'strict-dynamic' extends trust to them); the Picker frame and the API are
 * the narrow Google exceptions in `csp.ts`.
 */

export interface PickerConfig {
  clientId: string;
  apiKey: string;
  /** The Cloud project NUMBER — `drive.file` grants picked files to this app. */
  appId: string;
}

export interface PickedFile {
  id: string;
  name: string;
  mimeType: string;
}

const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";

/* The slices of Google's globals this module touches, typed here rather than
   pulling in two @types packages for a dozen calls. */
interface TokenResponse {
  access_token?: string;
  /** Seconds until the token lapses — about an hour. */
  expires_in?: number;
  error?: string;
}
interface TokenClient {
  requestAccessToken: (options?: { prompt?: string }) => void;
}
interface PickerDoc {
  id: string;
  name: string;
  mimeType: string;
}
interface PickerData {
  action: string;
  docs?: PickerDoc[];
}
interface GoogleGlobal {
  accounts: {
    oauth2: {
      initTokenClient: (config: {
        client_id: string;
        scope: string;
        callback: (response: TokenResponse) => void;
        error_callback?: (error: { type: string }) => void;
      }) => TokenClient;
    };
  };
  picker: {
    DocsView: new (viewId?: string) => {
      setIncludeFolders: (value: boolean) => unknown;
      setFileIds: (ids: string) => unknown;
      setMode: (mode: string) => unknown;
    };
    PickerBuilder: new () => PickerBuilder;
    ViewId: { DOCS: string; SPREADSHEETS: string };
    DocsViewMode: { GRID: string };
    Feature: { MULTISELECT_ENABLED: string };
    Action: { PICKED: string; CANCEL: string };
  };
}
interface PickerBuilder {
  addView: (view: unknown) => PickerBuilder;
  enableFeature: (feature: string) => PickerBuilder;
  setOAuthToken: (token: string) => PickerBuilder;
  setDeveloperKey: (key: string) => PickerBuilder;
  setAppId: (id: string) => PickerBuilder;
  setTitle: (title: string) => PickerBuilder;
  setMaxItems: (count: number) => PickerBuilder;
  setCallback: (callback: (data: PickerData) => void) => PickerBuilder;
  build: () => { setVisible: (visible: boolean) => void };
}
interface GapiGlobal {
  load: (library: string, callback: () => void) => void;
}

function googleGlobal(): GoogleGlobal | undefined {
  return (window as unknown as { google?: GoogleGlobal }).google;
}

const loading = new Map<string, Promise<void>>();

/** Insert a Google loader once; later calls share the same promise. */
function loadScript(src: string): Promise<void> {
  const existing = loading.get(src);
  if (existing !== undefined) {
    return existing;
  }
  const promise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => {
      resolve();
    };
    script.onerror = () => {
      loading.delete(src);
      reject(new Error("Couldn't reach Google. Check your connection and try again."));
    };
    document.head.appendChild(script);
  });
  loading.set(src, promise);
  return promise;
}

const SIGN_IN_SCRIPT = "https://accounts.google.com/gsi/client";
const PICKER_SCRIPT = "https://apis.google.com/js/api.js";

/**
 * Load Google's two loaders AHEAD of the click.
 *
 * Browsers only let a page open a pop-up during the click that asked for it.
 * Loading the sign-in script inside the click handler spent that moment on a
 * network round trip, and Chrome then blocked Google's window without a word —
 * the button sat on "Waiting for Google…" forever. Called when the Drive
 * option is shown, so the click can open the window straight away.
 */
export function preloadGoogle(): void {
  void loadScript(SIGN_IN_SCRIPT).catch(() => undefined);
  void loadScript(PICKER_SCRIPT).catch(() => undefined);
}

/*
 * ONE SIGN-IN PER SITTING. A sync reads the sheet and then, straight away,
 * asks for the new players' photos; a second Google window for the second
 * half made one job feel like two. The token is kept IN THIS PAGE ONLY (never
 * sent to us, gone on reload) and reused until a minute before it lapses.
 */
let held: { token: string; until: number } | null = null;

/** A token from this sitting that still has time on it — no window needed. */
export function hasFreshDriveToken(): boolean {
  return held !== null && Date.now() < held.until;
}

/** Ask Google for a short-lived token that can read the files the person picks. */
export async function requestDriveToken(clientId: string): Promise<string> {
  if (held !== null && Date.now() < held.until) {
    return held.token;
  }
  // Already loaded (the normal case, see `preloadGoogle`): no await, so the
  // pop-up opens inside the click and is not blocked.
  if (googleGlobal()?.accounts === undefined) {
    await loadScript(SIGN_IN_SCRIPT);
  }
  const google = googleGlobal();
  if (google === undefined) {
    throw new Error("Google sign-in didn't load. Try again.");
  }
  return new Promise<string>((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: DRIVE_FILE_SCOPE,
      callback: (response) => {
        if (response.access_token !== undefined) {
          held = {
            token: response.access_token,
            until: Date.now() + Math.max(0, (response.expires_in ?? 3600) - 60) * 1000,
          };
          resolve(response.access_token);
        } else {
          reject(new Error("Google didn't give access. Try again, and allow access when asked."));
        }
      },
      error_callback: (error) => {
        reject(
          new Error(
            error.type === "popup_closed"
              ? "The Google window was closed before access was given."
              : "Your browser blocked the Google window. Allow pop-ups for this site (the icon at the end of the address bar), then try again.",
          ),
        );
      },
    });
    client.requestAccessToken({ prompt: "" });
  });
}

/**
 * Open Google's Picker on exactly these files. Resolves with what was picked —
 * an empty list when the person cancels.
 */
export async function pickDriveFiles(
  config: PickerConfig,
  token: string,
  fileIds: readonly string[],
): Promise<PickedFile[]> {
  await loadScript(PICKER_SCRIPT);
  const gapi = (window as unknown as { gapi?: GapiGlobal }).gapi;
  if (gapi === undefined) {
    throw new Error("Google's file picker didn't load. Try again.");
  }
  await new Promise<void>((resolve) => {
    gapi.load("picker", resolve);
  });
  const google = googleGlobal();
  if (google === undefined) {
    throw new Error("Google's file picker didn't load. Try again.");
  }
  const { picker } = google;
  const view = new picker.DocsView(picker.ViewId.DOCS);
  view.setIncludeFolders(false);
  view.setMode(picker.DocsViewMode.GRID);
  view.setFileIds(fileIds.join(","));
  return new Promise<PickedFile[]>((resolve) => {
    new picker.PickerBuilder()
      .addView(view)
      .enableFeature(picker.Feature.MULTISELECT_ENABLED)
      .setOAuthToken(token)
      .setDeveloperKey(config.apiKey)
      .setAppId(config.appId)
      .setTitle("Select all the photos (Ctrl+A or ⌘A), then press Select")
      .setMaxItems(Math.max(1, fileIds.length))
      .setCallback((data) => {
        if (data.action === picker.Action.PICKED) {
          resolve(
            (data.docs ?? []).map((doc) => ({
              id: doc.id,
              name: doc.name,
              mimeType: doc.mimeType,
            })),
          );
        } else if (data.action === picker.Action.CANCEL) {
          resolve([]);
        }
      })
      .build()
      .setVisible(true);
  });
}

/**
 * Pick ONE Google Sheet — the form's linked responses sheet. Resolves with it,
 * or null when the person cancels. Picking is what grants this app access to
 * that one file (drive.file), which lasts until they remove it in Google.
 */
export async function pickDriveSheet(
  config: PickerConfig,
  token: string,
): Promise<PickedFile | null> {
  await loadScript(PICKER_SCRIPT);
  const gapi = (window as unknown as { gapi?: GapiGlobal }).gapi;
  if (gapi === undefined) {
    throw new Error("Google's file picker didn't load. Try again.");
  }
  await new Promise<void>((resolve) => {
    gapi.load("picker", resolve);
  });
  const google = googleGlobal();
  if (google === undefined) {
    throw new Error("Google's file picker didn't load. Try again.");
  }
  const { picker } = google;
  const view = new picker.DocsView(picker.ViewId.SPREADSHEETS);
  view.setIncludeFolders(true);
  return new Promise<PickedFile | null>((resolve) => {
    new picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(token)
      .setDeveloperKey(config.apiKey)
      .setAppId(config.appId)
      .setTitle("Choose your form's responses sheet")
      .setCallback((data) => {
        if (data.action === picker.Action.PICKED) {
          const doc = data.docs?.[0];
          resolve(
            doc === undefined ? null : { id: doc.id, name: doc.name, mimeType: doc.mimeType },
          );
        } else if (data.action === picker.Action.CANCEL) {
          resolve(null);
        }
      })
      .build()
      .setVisible(true);
  });
}

/**
 * A connected Sheet's rows as CSV — Drive exports the FIRST tab, which for a
 * Form's linked sheet is "Form responses 1". Throws `SheetAccessLost` when
 * Google no longer lets this app open it (removed, or access withdrawn), so
 * the screen can offer to pick it again rather than just failing.
 */
export class SheetAccessLost extends Error {}

export async function exportSheetCsv(token: string, sheetId: string): Promise<string> {
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(sheetId)}/export?mimeType=text/csv`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (response.status === 403 || response.status === 404) {
    throw new SheetAccessLost("We can't open that sheet any more — choose it again.");
  }
  if (!response.ok) {
    throw new Error("Couldn't read the sheet from Google. Try again.");
  }
  return response.text();
}

/** One picked file's bytes, as a File named the way Drive names it. */
export async function downloadDriveFile(token: string, file: PickedFile): Promise<File> {
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}?alt=media`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (!response.ok) {
    throw new Error(
      response.status === 404 || response.status === 403
        ? "Google didn't allow this photo — pick it again in the Google window."
        : "Couldn't download this photo from Google Drive.",
    );
  }
  const blob = await response.blob();
  return new File([blob], file.name, { type: blob.type || file.mimeType });
}
