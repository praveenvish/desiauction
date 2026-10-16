/** Owned loopback services for the isolated auction measurement/recovery checks. */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect } from "@playwright/test";

for (const name of [
  "DATABASE_URL",
  "APP_DATABASE_URL",
  "SYSTEM_DATABASE_URL",
  "RUNNER_DATABASE_URL",
]) {
  // Explicit four-role guard before any synthetic fixture access.
  // eslint-disable-next-line no-restricted-syntax
  const url = new URL(process.env[name] ?? "");
  if (url.hostname !== "127.0.0.1" || url.port !== "15437" || url.pathname !== "/ls1_c29_clean")
    throw new Error(`Unsafe auction validation target: ${name}`);
}
export const origin = "http://localhost:3050";
export const prior = ".next-ui-e09-safety10";
export const candidate = ".next-ui-e09-money-final";
export async function buildIds(): Promise<Record<string, string>> {
  return Object.fromEntries(
    await Promise.all(
      [prior, candidate].map(async (directory): Promise<[string, string]> => [
        directory,
        (await readFile(path.join(directory, "BUILD_ID"), "utf8")).trim(),
      ]),
    ),
  );
}
export async function record(directory: string, name: string, data: unknown) {
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, name), JSON.stringify(data, null, 2) + "\n");
}
export function ownedServices(directory: string) {
  let web: ChildProcess | undefined;
  let engine: ChildProcess | undefined;
  const webRoot = process.cwd();
  async function available(url: string) {
    try {
      await fetch(url);
      throw new Error(`Validation service already occupied: ${url}`);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Validation service already occupied"))
        throw error;
    }
  }
  async function wait(child: ChildProcess, url: string) {
    await expect
      .poll(
        async () => {
          if (child.exitCode !== null)
            throw new Error(`Owned service exited ${String(child.exitCode)}`);
          try {
            return (await fetch(url)).status;
          } catch {
            return 0;
          }
        },
        { timeout: 30000 },
      )
      .toBe(200);
  }
  async function stopChild(child: ChildProcess | undefined) {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Owned service did not stop"));
      }, 30000);
      child.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
      child.kill("SIGTERM");
    });
  }
  function capture(child: ChildProcess, name: string) {
    let log = "";
    child.stdout?.on("data", (value: Buffer) => {
      log += value.toString();
    });
    child.stderr?.on("data", (value: Buffer) => {
      log += value.toString();
    });
    child.once("exit", () => {
      void writeFile(path.join(directory, `${name}.log`), log);
    });
  }
  return {
    async engine() {
      if (engine) throw new Error("Duplicate owned engine start");
      await mkdir(directory, { recursive: true });
      await available("http://127.0.0.1:4000/healthz");
      engine = spawn(
        process.execPath,
        ["--env-file-if-exists=../../.env.local", "node_modules/tsx/dist/cli.mjs", "src/index.ts"],
        {
          cwd: path.resolve(webRoot, "../engine"),
          // Inherits the four explicit isolated URLs above; no fallback database.
          // eslint-disable-next-line no-restricted-syntax
          env: { ...process.env },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      capture(engine, "engine");
      await wait(engine, "http://127.0.0.1:4000/healthz");
    },
    async web(dist: string) {
      await stopChild(web);
      web = undefined;
      await mkdir(directory, { recursive: true });
      await available(`${origin}/healthz`);
      web = spawn(
        process.execPath,
        [
          "--env-file-if-exists=../../.env.local",
          "node_modules/next/dist/bin/next",
          "start",
          "--port",
          "3050",
        ],
        {
          cwd: webRoot,
          // Presentation is refined in both matched builds; all safety fixes unconditional.
          env: {
            // Validation process inherits only the explicitly guarded environment.
            // eslint-disable-next-line no-restricted-syntax
            ...process.env,
            NEXT_DIST_DIR: dist,
            UI_TREATMENT: "refined",
            EMAIL_PROVIDER: "dev",
            LOGIN_DEFAULT_METHOD: "phone",
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      capture(web, dist);
      await wait(web, `${origin}/healthz`);
    },
    async stop() {
      try {
        await stopChild(web);
        web = undefined;
      } finally {
        await stopChild(engine);
        engine = undefined;
      }
    },
  };
}
