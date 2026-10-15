/** Same-origin safe prior → visual candidate → safe prior, with actual work retained. */
import { cp, readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { chromium, expect, type Page } from "@playwright/test";
import { canonical, recovery, settled, stage } from "../e2e/ui-auction-fixtures";
import {
  committedQueue,
  persistedQueue,
  readScoringFixture,
  readyOffline,
  runBall,
  scoringSession,
  seedScoringFixture,
  sent,
  startScoring,
} from "../e2e/scoring-fixtures";
import { buildIds, candidate, origin, ownedServices, prior, record } from "./ui-auction-validation";

const output = "/tmp/ui-e09-money-final-rollback";
const builds = await buildIds();
const services = ownedServices(output);
const browser = await chromium.launch();
const stamp = Date.now();
const backward = `.next-ui-e09-backward-${String(stamp)}`;
const forward = `.next-ui-e09-forward-${String(stamp)}`;
const errors: string[] = [];
const assetHttpErrors: Array<{ url: string; status: number; phase: string; documentId: number }> =
  [];
const assetFailures: Array<{
  url: string;
  failure: string | null;
  resource: string;
  phase: string;
  documentId: number;
}> = [];
const parsed = new Map<Page, Set<string>>();
type PolicyPayload = {
  blockedURI: string;
  effectiveDirective: string;
  disposition: string;
  sourceFile: string;
  elements: Array<{
    tag: string;
    src: string | null;
    rel: string | null;
    noncePresent: boolean;
    integrity: string | null;
  }>;
};
const policyViolations: Array<{
  phase: string;
  pageId: number;
  loaderId: string;
  payload: PolicyPayload;
}> = [];
type ScriptRequest = {
  requestId: string;
  pageId: number;
  loaderId: string;
  phase: string;
  url: string;
  initiator: { type: string };
  status?: number;
  blockedReason?: string;
  error?: string;
};
const scriptRequests = new Map<string, ScriptRequest>();
const parsedDocuments = new Map<string, Set<string>>();
const currentLoaders = new Map<Page, string>();
const documentPolicies: Array<{
  pageId: number;
  loaderId: string;
  phase: string;
  url: string;
  status: number;
  csp: string | null;
}> = [];
let phase = "setup";
let release = () => {};
async function inventory(root: string, prefix = ""): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const entry of await readdir(path.join(root, prefix), { withFileTypes: true })) {
    const name = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) Object.assign(out, await inventory(root, name));
    else
      out[name] = createHash("sha256")
        .update(await readFile(path.join(root, name)))
        .digest("hex");
  }
  return out;
}
async function observe(page: Page) {
  const files = new Set<string>();
  const pageId = parsed.size + 1;
  parsed.set(page, files);
  const session = await page.context().newCDPSession(page);
  const frameTree = await session.send("Page.getFrameTree");
  const mainFrameId = frameTree.frameTree.frame.id;
  const frames = new Map<string, string>([[mainFrameId, frameTree.frameTree.frame.loaderId]]);
  const contexts = new Map<number, string>();
  let loaderId = frameTree.frameTree.frame.loaderId;
  currentLoaders.set(page, loaderId);
  await page.exposeBinding("__rollbackPolicy", (_source, payload: PolicyPayload) => {
    policyViolations.push({ phase, pageId, loaderId, payload });
  });
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      const payload = {
        blockedURI: event.blockedURI,
        effectiveDirective: event.effectiveDirective,
        disposition: event.disposition,
        sourceFile: event.sourceFile,
        lineNumber: event.lineNumber,
        columnNumber: event.columnNumber,
        elements: [...document.querySelectorAll("script[src],link[as='script']")].map(
          (element) => ({
            tag: element.tagName,
            src: element.getAttribute("src") ?? element.getAttribute("href"),
            rel: element.getAttribute("rel"),
            noncePresent: Boolean((element as HTMLScriptElement).nonce),
            integrity: element.getAttribute("integrity"),
          }),
        ),
      };
      void (window as unknown as { __rollbackPolicy: (payload: unknown) => Promise<void> })
        .__rollbackPolicy(payload)
        .catch(() => undefined);
    });
  });
  page.on("pageerror", (error) => errors.push(`${phase}: ${error.message}`));
  page.on("response", (response) => {
    if (response.url().includes("/_next/static/") && response.status() >= 400)
      assetHttpErrors.push({
        url: response.url(),
        status: response.status(),
        phase,
        documentId: pageId,
      });
  });
  page.on("requestfailed", (request) => {
    if (request.url().includes("/_next/static/"))
      assetFailures.push({
        url: request.url(),
        failure: request.failure()?.errorText ?? null,
        resource: request.resourceType(),
        phase,
        documentId: pageId,
      });
  });
  session.on(
    "Network.requestWillBeSent",
    (event: {
      requestId: string;
      loaderId: string;
      frameId?: string;
      type?: string;
      request: { url: string };
      initiator: { type: string };
    }) => {
      if (event.type === "Document" && event.frameId) {
        frames.set(event.frameId, event.loaderId);
        if (event.frameId === mainFrameId) {
          loaderId = event.loaderId;
          currentLoaders.set(page, loaderId);
        }
      }
      if (event.type === "Script" && event.request.url.includes("/_next/static/"))
        scriptRequests.set(`${String(pageId)}:${event.requestId}`, {
          requestId: event.requestId,
          pageId,
          loaderId: event.loaderId,
          phase,
          url: event.request.url,
          initiator: event.initiator,
        });
    },
  );
  session.on(
    "Network.loadingFailed",
    (event: { requestId: string; blockedReason?: string; errorText: string }) => {
      const row = scriptRequests.get(`${String(pageId)}:${event.requestId}`);
      if (row) Object.assign(row, { blockedReason: event.blockedReason, error: event.errorText });
    },
  );
  session.on(
    "Network.responseReceived",
    (event: {
      requestId: string;
      loaderId: string;
      type: string;
      response: { url: string; status: number; headers: Record<string, string> };
    }) => {
      const row = scriptRequests.get(`${String(pageId)}:${event.requestId}`);
      if (row) row.status = event.response.status;
      if (event.type === "Document")
        documentPolicies.push({
          pageId,
          loaderId: event.loaderId,
          phase,
          url: event.response.url,
          status: event.response.status,
          csp:
            Object.entries(event.response.headers).find(
              ([name]) => name.toLowerCase() === "content-security-policy",
            )?.[1] ?? null,
        });
    },
  );
  session.on(
    "Runtime.executionContextCreated",
    (event: { context: { id: number; auxData?: { frameId?: string; isDefault?: boolean } } }) => {
      const frame = event.context.auxData?.frameId;
      const contextLoader = frame ? frames.get(frame) : undefined;
      if (contextLoader !== undefined) contexts.set(event.context.id, contextLoader);
    },
  );
  session.on("Debugger.scriptParsed", (event: { url: string; executionContextId: number }) => {
    const marker = "/_next/static/",
      at = event.url.indexOf(marker);
    if (at < 0) return;
    const asset = event.url.slice(at + marker.length).split("?")[0];
    if (!asset) throw new Error("Missing parsed asset path");
    files.add(asset);
    const contextLoader = contexts.get(event.executionContextId);
    if (!contextLoader) return;
    const key = `${String(pageId)}:${contextLoader}`;
    const rows = parsedDocuments.get(key) ?? new Set<string>();
    rows.add(event.url);
    parsedDocuments.set(key, rows);
  });
  await session.send("Network.enable");
  await session.send("Runtime.enable");
  await session.send("Debugger.enable");
}
async function actualMenu(page: Page) {
  await page.getByTestId("pad-menu").click();
  await page.getByTestId("menu-theme").click();
  await page.getByTestId("menu-theme-daylight").click();
  await expect(page.getByTestId("pad-run-0")).toBeEnabled();
}
async function retained(page: Page, fixtureId: string) {
  return page.evaluate(async (id) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open("keyval-store");
      open.onsuccess = () => {
        resolve(open.result);
      };
      open.onerror = () => {
        reject(open.error ?? new Error("IndexedDB open failed"));
      };
    });
    try {
      return await new Promise<Record<string, unknown>>((resolve, reject) => {
        const tx = db.transaction("keyval", "readonly"),
          values: Record<string, unknown> = {};
        for (const key of [
          "da:scoring-epoch",
          "ls1:actor",
          "ls1:device",
          `ls1:queue:${id}`,
          `ls1:prepared:${id}`,
        ]) {
          const request = tx.objectStore("keyval").get(key);
          request.onsuccess = () => {
            values[key] = request.result as unknown;
          };
        }
        tx.oncomplete = () => {
          resolve(values);
        };
        tx.onerror = () => {
          reject(tx.error ?? new Error("IndexedDB read failed"));
        };
        tx.onabort = () => {
          reject(tx.error ?? new Error("IndexedDB read aborted"));
        };
      });
    } finally {
      db.close();
    }
  }, fixtureId);
}
try {
  const assets = {
    prior: await inventory(path.join(prior, "static")),
    candidate: await inventory(path.join(candidate, "static")),
  };
  for (const [name, hash] of Object.entries(assets.prior))
    if (assets.candidate[name] && assets.candidate[name] !== hash)
      throw new Error(`Immutable asset collision: ${name}`);
  for (const [base, extra, destination] of [
    [prior, candidate, backward],
    [candidate, prior, forward],
  ]) {
    if (!base || !extra || !destination) throw new Error("Missing rehearsal build");
    await cp(base, destination, {
      recursive: true,
      filter: (source) =>
        !source.split(path.sep).includes("cache") && !source.split(path.sep).includes("standalone"),
    });
    await cp(path.join(extra, "static"), path.join(destination, "static"), {
      recursive: true,
      force: false,
    });
  }
  await services.engine();
  await services.web(backward);
  phase = "prior";
  const auction = await stage(browser, false, 600);
  const scoring = await seedScoringFixture();
  const scoreContext = await browser.newContext({
    baseURL: origin,
    viewport: { width: 390, height: 844 },
  });
  try {
    await observe(auction.owner);
    await observe(auction.conductor);
    const old = auction.owner;
    const priorLoader = currentLoaders.get(old);
    if (!priorLoader) throw new Error("Missing prior owner document loader");
    const ownerPriorDocument = `${String([...parsed.keys()].indexOf(old) + 1)}:${priorLoader}`;
    await expect(old.getByTestId("auction-task-context")).toHaveCount(0);
    await scoringSession(scoreContext, scoring.actorToken);
    const scoreOld = await scoreContext.newPage();
    await observe(scoreOld);
    await startScoring(scoreOld, scoring);
    await runBall(scoreOld, 1);
    await actualMenu(scoreOld);
    await readyOffline(scoreOld, scoring.fixtureId);
    const matchBefore = await readScoringFixture(scoring.fixtureId);
    await scoreContext.setOffline(true);
    await runBall(scoreOld);
    const eventIds = await committedQueue(scoreOld, scoring.fixtureId, ["ball"]);
    const storageBefore = await retained(scoreOld, scoring.fixtureId);
    const queuedBefore = storageBefore[`ls1:queue:${scoring.fixtureId}`] as
      Array<{ event: { eventId: string; attempt: number } }> | undefined;
    const preparedBefore = storageBefore[`ls1:prepared:${scoring.fixtureId}`] as
      { attempt: number; bootstrap: unknown } | undefined;
    if (!queuedBefore?.[0] || !preparedBefore) throw new Error("Missing prepared scoring identity");
    expect(queuedBefore[0].event.attempt).toBe(preparedBefore.attempt);
    let bids = 0;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await old.route(`**/seasons/${auction.data.slug}/auction/live`, async (route) => {
      if (
        route.request().method() === "POST" &&
        route.request().postData()?.includes('"PlaceBid"')
      ) {
        bids++;
        await route.fetch();
        await gate;
        await route.abort("failed");
      } else await route.continue();
    });
    await old.getByTestId("bid-next").click();
    await expect.poll(async () => (await canonical(auction.auctionId)).bids.length).toBe(1);
    const intent = (await recovery(old)).find((marker) => marker.type === "PlaceBid");
    if (!intent) throw new Error("Missing held bid marker");
    const accepted = (await canonical(auction.auctionId)).bids[0];
    if (!accepted) throw new Error("Missing accepted actual bid");
    const oldUrl = old.url(),
      scoreOldUrl = scoreOld.url();
    await scoreContext.route(`**/api/score/${scoring.fixtureId}/events`, (route) =>
      route.abort("internetdisconnected"),
    );
    await record(output, "checkpoint.json", {
      phase,
      builds,
      auctionId: auction.auctionId,
      intent,
      eventIds,
      storageBefore,
    });
    phase = "candidate";
    await services.web(forward);
    const fresh = await auction.ownerContext.newPage();
    await observe(fresh);
    await fresh.goto(`/seasons/${auction.data.slug}/auction/live`);
    await expect(fresh.getByTestId("auction-task-context")).toContainText("Owner room");
    await expect(fresh.getByTestId("auction-command-recovery")).toContainText(
      "Command outcome unknown",
    );
    expect(
      (await recovery(fresh)).find((marker) => marker.commandId === intent.commandId),
    ).toBeDefined();
    await expect(old.getByTestId("auction-task-context")).toHaveCount(0);
    const candidateLoader = currentLoaders.get(fresh);
    if (!candidateLoader) throw new Error("Missing candidate owner document loader");
    const ownerCandidateDocument = `${String([...parsed.keys()].indexOf(fresh) + 1)}:${candidateLoader}`;
    expect(old.url()).toBe(oldUrl);
    const conductFresh = await auction.conductorContext.newPage();
    await observe(conductFresh);
    await conductFresh.goto(`/seasons/${auction.data.slug}/auction/cockpit`);
    await expect(conductFresh.getByTestId("auction-task-context")).toContainText("Conductor desk");
    await conductFresh.getByTestId("cockpit-pause").click();
    await expect
      .poll(async () => (await canonical(auction.auctionId)).projection.status)
      .toBe("paused");
    await settled(conductFresh);
    release();
    await expect(old.getByTestId("auction-command-recovery")).toContainText(
      "Command outcome unknown",
    );
    await old.unrouteAll({ behavior: "wait" });
    await scoreContext.setOffline(false);
    const scoreFresh = await scoreContext.newPage();
    await observe(scoreFresh);
    await scoreFresh.goto(`/score/${scoring.fixtureId}`);
    await expect(scoreFresh.getByTestId("pad-sync")).toHaveAttribute("data-pending", "1");
    await actualMenu(scoreFresh);
    const storageForward = await retained(scoreFresh, scoring.fixtureId);
    for (const key of ["da:scoring-epoch", "ls1:actor", "ls1:device"])
      expect(storageForward[key]).toEqual(storageBefore[key]);
    expect(
      (storageForward[`ls1:prepared:${scoring.fixtureId}`] as { attempt: number }).attempt,
    ).toBe(preparedBefore.attempt);
    expect(
      (await persistedQueue(scoreFresh, scoring.fixtureId)).map((item) => item.event.eventId),
    ).toEqual(eventIds);
    await scoreContext.setOffline(true);
    const offline = await scoreContext.newPage();
    await observe(offline);
    await offline.goto(`/score/${scoring.fixtureId}`);
    await expect(offline).toHaveURL(`/score/shell#${scoring.fixtureId}`);
    await expect(offline.getByTestId("pad-run-0")).toBeEnabled();
    await expect(offline.getByTestId("pad-score")).toHaveText("1/0");
    expect(
      (await persistedQueue(offline, scoring.fixtureId)).map((item) => item.event.eventId),
    ).toEqual(eventIds);
    await offline.close();
    phase = "restored-prior";
    await services.web(backward);
    const restored = await auction.ownerContext.newPage();
    await observe(restored);
    await restored.goto(`/seasons/${auction.data.slug}/auction/live`);
    await expect(restored.getByTestId("auction-task-context")).toHaveCount(0);
    await expect(fresh.getByTestId("auction-task-context")).toContainText("Owner room");
    expect(
      (await recovery(restored)).find((marker) => marker.commandId === intent.commandId)?.state,
    ).toBe("unknown");
    await expect(restored.getByTestId("auction-command-recovery")).toContainText(
      "Command outcome unknown",
    );
    expect(bids).toBe(1);
    const conductRestored = await auction.conductorContext.newPage();
    await observe(conductRestored);
    await conductRestored.goto(`/seasons/${auction.data.slug}/auction/cockpit`);
    await conductRestored.getByTestId("cockpit-resume").click();
    await expect(conductRestored.getByTestId("ribbon-status")).toHaveText("live");
    await settled(conductRestored);
    await conductRestored.getByTestId("cockpit-gavel").hover();
    await conductRestored.mouse.down();
    await conductRestored.waitForTimeout(900);
    await conductRestored.mouse.up();
    await expect
      .poll(
        async () =>
          (await canonical(auction.auctionId)).lots.find((lot) => lot.id === accepted.lotId)
            ?.status,
      )
      .toBe("sold");
    await settled(conductRestored);
    const auctionAfter = await canonical(auction.auctionId);
    expect(auctionAfter.bids).toHaveLength(1);
    expect(auctionAfter.bids[0]?.id).toBe(accepted.id);
    expect(auctionAfter.lots.find((lot) => lot.id === accepted.lotId)?.soldPrice).toBe(
      accepted.amount,
    );
    expect(auctionAfter.projection.paddles[accepted.paddleId]?.committed).toBe(accepted.amount);
    await restored
      .getByRole("button", { name: "Reviewed current room · allow a new action" })
      .click();
    await expect(restored.getByTestId("auction-command-recovery")).toHaveCount(0);
    await scoreContext.setOffline(false);
    const scoreRestored = await scoreContext.newPage();
    await observe(scoreRestored);
    await scoreRestored.goto(`/score/${scoring.fixtureId}`);
    await expect(scoreRestored.getByTestId("pad-sync")).toHaveAttribute("data-pending", "1");
    await actualMenu(scoreRestored);
    const storageBackward = await retained(scoreRestored, scoring.fixtureId);
    for (const key of ["da:scoring-epoch", "ls1:actor", "ls1:device"])
      expect(storageBackward[key]).toEqual(storageBefore[key]);
    expect(
      (storageBackward[`ls1:prepared:${scoring.fixtureId}`] as { attempt: number }).attempt,
    ).toBe(preparedBefore.attempt);
    expect(
      (await persistedQueue(scoreRestored, scoring.fixtureId)).map((item) => item.event.eventId),
    ).toEqual(eventIds);
    expect(scoreOld.url()).toBe(scoreOldUrl);
    await scoreContext.unroute(`**/api/score/${scoring.fixtureId}/events`);
    await sent(scoreRestored);
    const matchAfter = await readScoringFixture(scoring.fixtureId);
    expect(matchAfter.match?.scorerPersonId).toBe(matchBefore.match?.scorerPersonId);
    expect(matchAfter.match?.scorerDeviceId).toBe(matchBefore.match?.scorerDeviceId);
    expect(matchAfter.match?.scorerClaimedAt).toEqual(matchBefore.match?.scorerClaimedAt);
    expect(matchAfter.match?.lastSeq).toBe((matchBefore.match?.lastSeq ?? 0) + 1);
    expect(
      matchAfter.events
        .filter((event) => eventIds.includes(event.eventId))
        .map((event) => event.eventId),
    ).toEqual(eventIds);
    const sessionPage = await auction.ownerContext.newPage();
    await observe(sessionPage);
    await sessionPage.goto("/account");
    await sessionPage.getByRole("button", { name: "Sign out", exact: true }).click();
    await sessionPage.getByTestId("sign-out-confirm").click();
    await expect(sessionPage).toHaveURL(/\/login/);
    await expect.poll(async () => (await recovery(restored)).length).toBe(0);
    await restored.goto(`/seasons/${auction.data.slug}/auction/live`);
    await expect(restored).toHaveURL(/\/login/);
    expect((await canonical(auction.auctionId)).bids).toHaveLength(1);
    const parsedRows = [...parsed.entries()].map(([page, files]) => ({
      url: page.url(),
      scripts: [...files],
    }));
    expect(
      [...(parsedDocuments.get(ownerPriorDocument) ?? [])].some((url) => {
        const file = url.split("/_next/static/")[1];
        return file && assets.prior[file] && !assets.candidate[file];
      }),
    ).toBe(true);
    expect(
      [...(parsedDocuments.get(ownerCandidateDocument) ?? [])].some((url) => {
        const file = url.split("/_next/static/")[1];
        return file && assets.candidate[file] && !assets.prior[file];
      }),
    ).toBe(true);
    await record(output, "functional-evidence.json", {
      status: "FUNCTIONAL-CHECKS-COMPLETED-ASSET-GATE-PENDING",
      builds,
      auctionId: auction.auctionId,
      acceptedBidId: accepted.id,
      acceptedAmount: accepted.amount,
      bidPosts: bids,
      intentId: intent.commandId,
      eventIds,
      storageBefore,
      storageForward,
      storageBackward,
      parsedRows,
      policyViolations,
      scriptRequests: [...scriptRequests.values()],
      documentPolicies,
      parsedDocuments: [...parsedDocuments].map(([document, scripts]) => ({
        document,
        scripts: [...scripts],
      })),
    });
    expect(errors).toEqual([]);
    expect(assetHttpErrors).toEqual([]);
    const knownChunks = new Set<string>();
    for (const dist of [prior, candidate]) {
      const manifest = JSON.parse(
        await readFile(path.join(dist, "react-loadable-manifest.json"), "utf8"),
      ) as Record<string, { files: string[] }>;
      const pad = manifest["app/score/[fixtureId]/families/pad-entries.tsx -> ../pad"];
      if (!pad) throw new Error("Missing authoritative pad asset manifest");
      for (const file of pad.files.filter((file) => file.endsWith(".js")))
        knownChunks.add(`${origin}/_next/${file}`);
    }
    const requests = [...scriptRequests.values()];
    const classifiedPreloads = requests.filter((failed) => {
      if (
        failed.blockedReason !== "csp" ||
        failed.initiator.type !== "parser" ||
        !knownChunks.has(failed.url)
      )
        return false;
      const document = `${String(failed.pageId)}:${failed.loaderId}`;
      const policy = policyViolations.find(
        (row) =>
          row.pageId === failed.pageId &&
          row.loaderId === failed.loaderId &&
          row.phase === failed.phase &&
          row.payload.blockedURI === failed.url &&
          row.payload.disposition === "enforce" &&
          row.payload.effectiveDirective === "script-src-elem",
      );
      const enforcedNoncePolicy = documentPolicies.some(
        (row) =>
          row.pageId === failed.pageId &&
          row.loaderId === failed.loaderId &&
          row.status === 200 &&
          row.csp?.includes("'strict-dynamic'") &&
          row.csp.includes("'nonce-"),
      );
      return (
        enforcedNoncePolicy &&
        policy?.payload.elements.some(
          (element) =>
            element.tag === "LINK" &&
            element.rel === "preload" &&
            !element.noncePresent &&
            element.src !== null &&
            new URL(element.src, origin).href === failed.url,
        ) &&
        parsedDocuments.get(document)?.has(failed.url) &&
        requests.some(
          (loaded) =>
            loaded.pageId === failed.pageId &&
            loaded.loaderId === failed.loaderId &&
            loaded.url === failed.url &&
            loaded.requestId !== failed.requestId &&
            loaded.status === 200 &&
            loaded.error === undefined &&
            loaded.blockedReason === undefined,
        )
      );
    });
    const unclassifiedRequests = requests.filter(
      (row) =>
        (row.error !== undefined || row.blockedReason !== undefined) &&
        !classifiedPreloads.includes(row),
    );
    const unclassifiedFailures = assetFailures.filter(
      (failure) =>
        !classifiedPreloads.some(
          (row) =>
            row.pageId === failure.documentId &&
            row.phase === failure.phase &&
            row.url === failure.url &&
            failure.failure === "csp" &&
            failure.resource === "script",
        ),
    );
    await record(output, "asset-classification.json", {
      knownChunks: [...knownChunks],
      classifiedPreloads,
      unclassifiedRequests,
      unclassifiedFailures,
      assetFailures,
      assetHttpErrors,
      policyViolations,
      documentPolicies,
      requests,
      parsedDocuments: [...parsedDocuments].map(([document, scripts]) => ({
        document,
        scripts: [...scripts],
      })),
    });
    expect(unclassifiedRequests).toEqual([]);
    expect(unclassifiedFailures).toEqual([]);
    await record(output, "result.json", {
      status: "PASS",
      builds,
      prior,
      candidate,
      backward,
      forward,
      phase,
      auctionId: auction.auctionId,
      acceptedBid: {
        id: accepted.id,
        amount: accepted.amount,
        lotId: accepted.lotId,
        paddleId: accepted.paddleId,
      },
      bidPosts: bids,
      intentId: intent.commandId,
      eventIds,
      storageBefore,
      storageForward,
      storageBackward,
      parsedRows,
      assetHttpErrors,
      assetFailures,
      classifiedPreloads,
      errors,
      sessionRevocation: "PASS",
      offlineBootstrap: "PASS",
      scoringAcceptance: "one canonical event",
      unknownBid: "retained and reviewed, never replayed",
    });
    console.log(
      "Same-origin safe prior → candidate → safe prior auction/scoring/asset/session rehearsal PASS",
    );
  } finally {
    release();
    await scoreContext.close();
    await auction.ownerContext.close();
    await auction.conductorContext.close();
  }
} finally {
  release();
  await record(output, "diagnostic.json", {
    phase,
    builds,
    errors,
    assetHttpErrors,
    assetFailures,
    policyViolations,
    scriptRequests: [...scriptRequests.values()],
    documentPolicies,
    parsedDocuments: [...parsedDocuments].map(([document, scripts]) => ({
      document,
      scripts: [...scripts],
    })),
  });
  await browser.close();
  await services.stop();
}
