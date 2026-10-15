import { writeFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { canonical, recovery, settled, stage } from "./ui-auction-fixtures";

async function claimRival(page: Page, slug: string) {
  await page.goto(`/seasons/${slug}/auction/live`);
  await expect(page.getByTestId("live-panel")).toHaveAttribute("data-hydrated", "true");
  const claim = page.getByTestId("claim-paddle");
  if (await claim.isVisible()) {
    await page.getByLabel("Team", { exact: true }).selectOption({ label: "LS1 Strikers" });
    await claim.click();
  }
  await expect(page.getByTestId("my-paddle")).toBeVisible();
  await settled(page);
}
async function nativeTrace(page: Page) {
  await page.evaluate(() => {
    const events: unknown[] = [];
    (window as unknown as { inputTrace: unknown[] }).inputTrace = events;
    for (const type of [
      "pointerdown",
      "mousedown",
      "pointerup",
      "pointercancel",
      "lostpointercapture",
      "keydown",
      "keyup",
      "click",
      "blur",
      "focusout",
    ]) {
      window.addEventListener(type, (event) => {
        const pointer = event instanceof PointerEvent ? event : null;
        const mouse = event instanceof MouseEvent ? event : null;
        const keyboard = event instanceof KeyboardEvent ? event : null;
        const rect = document.querySelector('[data-testid="bid-next"]')?.getBoundingClientRect();
        events.push({
          type,
          constructor: event.constructor.name,
          trusted: event.isTrusted,
          id: pointer?.pointerId ?? null,
          pointer: pointer?.pointerType ?? null,
          primary: pointer?.isPrimary ?? null,
          detail: mouse?.detail ?? null,
          key: keyboard?.key ?? null,
          repeat: keyboard?.repeat ?? null,
          prevented: event.defaultPrevented,
          target:
            event.target instanceof Element
              ? (event.target.closest("[data-testid]")?.getAttribute("data-testid") ??
                event.target.tagName)
              : null,
          amount: document.querySelector('[data-testid="bid-next"]')?.getAttribute("data-amount"),
          bidRect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
          scroll: { x: window.scrollX, y: window.scrollY },
        });
      });
    }
  });
}
async function stableMouseClick(page: Page) {
  const bid = page.getByTestId("bid-next");
  await bid.scrollIntoViewIfNeeded();
  await bid.hover();
  const before = await bid.boundingBox();
  if (!before) throw new Error("Missing native Bid rectangle");
  const layout = await bid.evaluate((element) => {
    const target = element as HTMLButtonElement;
    (window as unknown as { bidFocusParent: Element | null }).bidFocusParent = target.offsetParent;
    return {
      top: target.offsetTop,
      left: target.offsetLeft,
      width: target.offsetWidth,
      height: target.offsetHeight,
    };
  });
  const scroll = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
  let posts = 0;
  const request = (value: import("@playwright/test").Request) => {
    if (value.method() === "POST" && value.postData()?.includes('"PlaceBid"')) posts++;
  };
  page.on("request", request);
  await page.mouse.down();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            resolve();
          });
        }),
      ),
  );
  await expect(bid).toBeFocused();
  const focusProof = await bid.evaluate(async (element, original) => {
    const target = element as HTMLButtonElement;
    await Promise.all(target.getAnimations().map((animation) => animation.finished));
    const style = getComputedStyle(target);
    const matrix = new DOMMatrixReadOnly(style.transform === "none" ? undefined : style.transform);
    const hit = document.elementFromPoint(
      original.x + original.width / 2,
      original.y + original.height / 2,
    );
    const held = target.getBoundingClientRect();
    return {
      held: { x: held.x, y: held.y, width: held.width, height: held.height },
      layout: {
        top: target.offsetTop,
        left: target.offsetLeft,
        width: target.offsetWidth,
        height: target.offsetHeight,
      },
      sameParent:
        target.offsetParent ===
        (window as unknown as { bidFocusParent: Element | null }).bidFocusParent,
      hit: hit !== null && target.contains(hit),
      transform: style.transform,
      origin: style.transformOrigin,
      matrix: { a: matrix.a, b: matrix.b, c: matrix.c, d: matrix.d, e: matrix.e, f: matrix.f },
    };
  }, before);
  await page.evaluate(
    (proof) => {
      const record = window as unknown as { focusMeasurements?: unknown[] };
      (record.focusMeasurements ??= []).push(proof);
    },
    { before, scroll, ...focusProof },
  );
  const held = focusProof.held;
  expect(focusProof.layout).toEqual(layout);
  expect(focusProof.sameParent).toBe(true);
  expect(focusProof.hit).toBe(true);
  // CSS's existing centered 0.98 press scale is allowed; displacement is not.
  expect(Math.abs(held.x + held.width / 2 - before.x - before.width / 2)).toBeLessThanOrEqual(0.01);
  expect(Math.abs(held.y + held.height / 2 - before.y - before.height / 2)).toBeLessThanOrEqual(
    0.01,
  );
  expect(focusProof.matrix.a).toBeGreaterThanOrEqual(0.97999);
  expect(focusProof.matrix.a).toBeLessThanOrEqual(1);
  expect(focusProof.matrix.d).toBe(focusProof.matrix.a);
  expect([
    focusProof.matrix.b,
    focusProof.matrix.c,
    focusProof.matrix.e,
    focusProof.matrix.f,
  ]).toEqual([0, 0, 0, 0]);
  expect(held.width / layout.width).toBeCloseTo(focusProof.matrix.a, 4);
  expect(held.height / layout.height).toBeCloseTo(focusProof.matrix.d, 4);
  expect(await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }))).toEqual(scroll);
  expect(posts).toBe(0);
  page.off("request", request);
  await page.mouse.up();
}
for (const width of [390, 1440]) {
  for (const mode of [
    "pointer",
    "space",
    "selected jump",
    "chip pointer",
    "chip keyboard",
    "enter repeat",
    "space and pointer",
    "outside key",
    "outside pointer",
    "lot",
  ] as const) {
    test(`${mode} keeps exact bid intent across live updates at ${String(width)}px`, async ({
      browser,
    }, info) => {
      const s = await stage(browser, false, 600);
      try {
        await s.owner.setViewportSize({ width, height: 844 });
        const rival = await s.conductorContext.newPage();
        await claimRival(rival, s.data.slug);
        const bid = s.owner.getByTestId("bid-next");
        await nativeTrace(s.owner);
        let posts = 0;
        s.owner.on("request", (request) => {
          if (request.method() === "POST" && request.postData()?.includes('"PlaceBid"')) posts++;
        });
        if (mode === "space and pointer") {
          await bid.focus();
          await s.owner.keyboard.down("Space");
          await rival.getByTestId("bid-next").click();
          await settled(rival);
          await expect(bid).toBeEnabled();
          await stableMouseClick(s.owner);
          await expect.poll(async () => (await canonical(s.auctionId)).bids.length).toBe(2);
          await settled(s.owner);
          await expect(rival.getByTestId("bid-next")).toBeEnabled();
          await rival.getByTestId("bid-next").click();
          await settled(rival);
          await expect(bid).toBeEnabled();
          await s.owner.keyboard.up("Space");
          await s.owner.waitForTimeout(600);
          expect(posts).toBe(1);
          expect((await canonical(s.auctionId)).bids).toHaveLength(3);
          expect(await recovery(s.owner)).toEqual([]);
          await bid.click();
          await expect.poll(async () => (await canonical(s.auctionId)).bids.length).toBe(4);
          await settled(s.owner);
          expect(posts).toBe(2);
        } else if (mode === "enter repeat") {
          await bid.focus();
          await s.owner.keyboard.down("Enter");
          await expect.poll(async () => (await canonical(s.auctionId)).bids.length).toBe(1);
          await settled(s.owner);
          await rival.getByTestId("bid-next").click();
          await settled(rival);
          await expect(bid).toBeEnabled();
          await s.owner.keyboard.down("Enter");
          await s.owner.waitForTimeout(600);
          expect(posts).toBe(1);
          expect((await canonical(s.auctionId)).bids).toHaveLength(2);
          await s.owner.keyboard.up("Enter");
          await bid.press("Enter");
          await expect.poll(async () => (await canonical(s.auctionId)).bids.length).toBe(3);
          await settled(s.owner);
          expect(posts).toBe(2);
        } else if (mode === "outside pointer") {
          await bid.hover();
          await s.owner.mouse.down();
          await s.owner.getByTestId("bid-ladder").getByRole("button").first().focus();
          await expect(bid).not.toBeFocused();
          await s.owner.mouse.up();
          await s.owner.waitForTimeout(600);
          expect(posts).toBe(0);
          expect((await canonical(s.auctionId)).bids).toHaveLength(0);
          expect(await recovery(s.owner)).toEqual([]);
          await stableMouseClick(s.owner);
          await expect.poll(async () => (await canonical(s.auctionId)).bids.length).toBe(1);
          await settled(s.owner);
          expect(posts).toBe(1);
        } else if (mode === "outside key") {
          await bid.focus();
          await s.owner.keyboard.down("Space");
          await s.owner.keyboard.press("Shift+Tab");
          await expect(bid).not.toBeFocused();
          await s.owner.keyboard.up("Space");
          await s.owner.waitForTimeout(600);
          expect(posts).toBe(0);
          expect((await canonical(s.auctionId)).bids).toHaveLength(0);
          expect(await recovery(s.owner)).toEqual([]);
          await bid.focus();
          const intended = await bid.getAttribute("data-amount");
          // Deliberate non-pointer activation, not a manual screen-reader claim.
          await bid.evaluate((element) => {
            (element as HTMLButtonElement).click();
          });
          await expect.poll(async () => (await canonical(s.auctionId)).bids.length).toBe(1);
          await settled(s.owner);
          expect(posts).toBe(1);
          expect(
            (await canonical(s.auctionId)).bids.filter((row) => row.amount === Number(intended)),
          ).toHaveLength(1);
        } else if (mode === "chip pointer" || mode === "chip keyboard") {
          const chip = s.owner.getByTestId("bid-ladder").getByRole("button").nth(1);
          const identity = await chip.getAttribute("data-testid");
          if (!identity) throw new Error("Missing exact chip identity");
          const exact = s.owner.getByTestId(identity);
          if (mode === "chip pointer") {
            await exact.hover();
            await s.owner.mouse.down();
          } else {
            await exact.focus();
            await s.owner.keyboard.down("Space");
          }
          await rival.getByTestId("bid-next").click();
          await settled(rival);
          await expect(bid).toBeEnabled();
          if (mode === "chip pointer") await s.owner.mouse.up();
          else await s.owner.keyboard.up("Space");
          await s.owner.waitForTimeout(600);
          expect(posts).toBe(0);
          expect((await canonical(s.auctionId)).bids).toHaveLength(1);
          expect(await recovery(s.owner)).toEqual([]);
          if (mode === "chip pointer") {
            await expect(
              s.owner.getByTestId("bid-ladder").locator('[aria-pressed="true"]'),
            ).toHaveCount(0);
            await exact.click();
          } else await expect(exact).toBeFocused();
          await expect(exact).toHaveAttribute("aria-pressed", "true");
          const chosen = identity.replace("bid-jump-", "");
          await expect(bid).toHaveAttribute("data-amount", chosen);
          await bid.click();
          await expect.poll(async () => (await canonical(s.auctionId)).bids.length).toBe(2);
          await settled(s.owner);
          expect(
            (await canonical(s.auctionId)).bids.filter((row) => row.amount === Number(chosen)),
          ).toHaveLength(1);
        } else {
          if (mode === "lot") {
            await rival.getByTestId("bid-next").click();
            await settled(rival);
            await expect(bid).toBeEnabled();
          }
          if (mode === "selected jump")
            await s.owner.getByTestId("bid-ladder").getByRole("button").nth(1).click();
          const original = await bid.getAttribute("data-amount");
          if (mode === "space" || mode === "selected jump") {
            await bid.focus();
            await s.owner.keyboard.down("Space");
          } else {
            await bid.hover();
            await s.owner.mouse.down();
          }
          if (mode === "lot") {
            await s.conductor.getByTestId("cockpit-gavel").hover();
            await s.conductor.mouse.down();
            await s.conductor.waitForTimeout(900);
            await s.conductor.mouse.up();
            await expect
              .poll(
                async () =>
                  (await canonical(s.auctionId)).lots.find((lot) => lot.lotNumber === "L001")
                    ?.status,
              )
              .toBe("sold");
            await s.conductor.getByTestId("open-L002").click();
            await settled(s.conductor);
            await expect(bid).toBeEnabled();
          } else {
            if (mode === "selected jump")
              await rival.getByTestId("bid-ladder").getByRole("button").nth(2).click();
            await rival.getByTestId("bid-next").click();
            await settled(rival);
            await expect(bid).not.toHaveAttribute("data-amount", original ?? "");
          }
          expect((await canonical(s.auctionId)).bids).toHaveLength(1);
          if (mode === "space" || mode === "selected jump") await s.owner.keyboard.up("Space");
          else await s.owner.mouse.up();
          // Observe actual activation/request delivery, with no held network request.
          await s.owner.waitForTimeout(600);
          expect(posts).toBe(0);
          expect((await canonical(s.auctionId)).bids).toHaveLength(1);
          expect(await recovery(s.owner)).toEqual([]);
          await expect(bid).toBeEnabled();
          await stableMouseClick(s.owner);
          await expect.poll(async () => (await canonical(s.auctionId)).bids.length).toBe(2);
          await settled(s.owner);
          if (mode === "lot") {
            const data = await canonical(s.auctionId);
            const nextLot = data.lots.find((lot) => lot.lotNumber === "L002");
            if (!nextLot) throw new Error("Missing exact next lot");
            expect(data.bids.filter((row) => row.lotId === nextLot.id)).toHaveLength(1);
          }
        }
        await info.attach("canonical-gesture-result", {
          contentType: "application/json",
          body: JSON.stringify({
            width,
            mode,
            posts,
            canonical: await canonical(s.auctionId),
            markers: await recovery(s.owner),
          }),
        });
      } finally {
        const path = info.outputPath("gesture-diagnostic.json");
        await writeFile(
          path,
          JSON.stringify(
            {
              width,
              mode,
              trace: await s.owner.evaluate(
                () => (window as unknown as { inputTrace: unknown }).inputTrace,
              ),
              canonical: await canonical(s.auctionId),
              markers: await recovery(s.owner),
              focusMeasurements: await s.owner.evaluate(
                () =>
                  (window as unknown as { focusMeasurements?: unknown[] }).focusMeasurements ?? [],
              ),
              settledGeometry: await s.owner.getByTestId("bid-next").boundingBox(),
              settledScroll: await s.owner.evaluate(() => ({
                x: window.scrollX,
                y: window.scrollY,
              })),
            },
            null,
            2,
          ),
        );
        await info.attach("gesture-diagnostic", { contentType: "application/json", path });
        await s.ownerContext.close();
        await s.conductorContext.close();
      }
    });
  }
}

for (const width of [390, 1440]) {
  for (const releaseOrder of ["touch first", "mouse first"] as const) {
    test(`primary touch/mouse overlap ${releaseOrder} at ${String(width)}px`, async ({
      browser,
    }, info) => {
      const s = await stage(browser, false, 600);
      try {
        await s.owner.setViewportSize({ width, height: 844 });
        const rival = await s.conductorContext.newPage();
        await claimRival(rival, s.data.slug);
        const bid = s.owner.getByTestId("bid-next");
        await bid.scrollIntoViewIfNeeded();
        const box = await bid.boundingBox();
        if (!box) throw new Error("Missing native bid target");
        const x = box.x + box.width / 2,
          y = box.y + box.height / 2;
        const cdp = await s.ownerContext.newCDPSession(s.owner);
        await s.owner.evaluate(() => {
          const trace: Array<{
            type: string;
            id: number;
            pointer: string;
            primary: boolean;
            detail: number;
            target: string | null;
            x: number;
            y: number;
            bidRect: unknown;
          }> = [];
          (window as unknown as { gestureTrace: typeof trace }).gestureTrace = trace;
          for (const type of [
            "pointerdown",
            "pointerup",
            "pointercancel",
            "lostpointercapture",
            "click",
          ]) {
            document.addEventListener(
              type,
              (event) => {
                if (!(event instanceof MouseEvent)) return;
                const pointer = event instanceof PointerEvent ? event : null;
                trace.push({
                  type,
                  id: pointer?.pointerId ?? -1,
                  pointer: pointer?.pointerType ?? "identity-less",
                  primary: pointer?.isPrimary ?? false,
                  detail: event.detail,
                  target:
                    event.target instanceof Element
                      ? (event.target.closest("[data-testid]")?.getAttribute("data-testid") ??
                        event.target.tagName)
                      : null,
                  x: event.clientX,
                  y: event.clientY,
                  bidRect: document
                    .querySelector('[data-testid="bid-next"]')
                    ?.getBoundingClientRect()
                    .toJSON(),
                });
              },
              true,
            );
          }
        });
        let posts = 0;
        s.owner.on("request", (request) => {
          if (request.method() === "POST" && request.postData()?.includes('"PlaceBid"')) posts++;
        });
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: [{ x, y, id: 7 }],
        });
        await rival.getByTestId("bid-next").click();
        await settled(rival);
        await expect(bid).toBeEnabled();
        await s.owner.mouse.move(x, y);
        const capturedMouseAmount = await bid.getAttribute("data-amount");
        await s.owner.mouse.down();
        if (releaseOrder === "touch first") {
          const beforeNotice = await bid.boundingBox();
          await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
          await expect(s.owner.getByTestId("bid-gesture-status")).toContainText("Press canceled");
          expect(await bid.boundingBox()).toEqual(beforeNotice);
          await s.owner.waitForTimeout(600);
          expect(posts).toBe(0);
        }
        await s.owner.mouse.up();
        const nativeMouseClicks = await s.owner.evaluate(
          () =>
            (
              window as unknown as {
                gestureTrace: Array<{ type: string; pointer: string; target: string | null }>;
              }
            ).gestureTrace.filter(
              (event) =>
                event.type === "click" && event.pointer !== "touch" && event.target === "bid-next",
            ).length,
        );
        expect(nativeMouseClicks).toBeLessThanOrEqual(1);
        if (releaseOrder === "mouse first") expect(nativeMouseClicks).toBe(1);
        if (nativeMouseClicks === 1) {
          await expect.poll(async () => (await canonical(s.auctionId)).bids.length).toBe(2);
          await settled(s.owner);
          expect(
            (await canonical(s.auctionId)).bids.filter(
              (row) => row.amount === Number(capturedMouseAmount),
            ),
          ).toHaveLength(1);
          expect(posts).toBe(1);
          await expect(rival.getByTestId("bid-next")).toBeEnabled();
          await rival.getByTestId("bid-next").click();
          await settled(rival);
          await expect(bid).toBeEnabled();
        } else {
          await s.owner.waitForTimeout(600);
          expect(posts).toBe(0);
          expect((await canonical(s.auctionId)).bids).toHaveLength(1);
        }
        if (releaseOrder === "mouse first") {
          const beforeNotice = await bid.boundingBox();
          await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
          await expect(s.owner.getByTestId("bid-gesture-status")).toContainText("Press canceled");
          expect(await bid.boundingBox()).toEqual(beforeNotice);
        }
        await s.owner.waitForTimeout(600);
        expect(posts).toBe(nativeMouseClicks);
        const priorCount = nativeMouseClicks === 1 ? 3 : 1;
        expect((await canonical(s.auctionId)).bids).toHaveLength(priorCount);
        expect(await recovery(s.owner)).toEqual([]);
        const trace = await s.owner.evaluate(
          () =>
            (
              window as unknown as {
                gestureTrace: Array<{
                  type: string;
                  id: number;
                  pointer: string;
                  primary: boolean;
                }>;
              }
            ).gestureTrace,
        );
        const touchDown = trace.findIndex(
          (event) => event.type === "pointerdown" && event.pointer === "touch" && event.primary,
        );
        const mouseDown = trace.findIndex(
          (event) => event.type === "pointerdown" && event.pointer === "mouse" && event.primary,
        );
        const touchUp = trace.findIndex(
          (event) => event.type === "pointerup" && event.pointer === "touch",
        );
        expect(touchDown).toBeGreaterThanOrEqual(0);
        expect(mouseDown).toBeGreaterThan(touchDown);
        expect(touchUp).toBeGreaterThan(mouseDown);
        expect(trace.filter((event) => event.type === "pointercancel")).toEqual([]);
        const freshBox = await bid.boundingBox();
        if (!freshBox) throw new Error("Missing fresh touch target");
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: [
            { x: freshBox.x + freshBox.width / 2, y: freshBox.y + freshBox.height / 2, id: 9 },
          ],
        });
        await expect(s.owner.getByTestId("bid-gesture-status")).toHaveText("");
        expect(await bid.boundingBox()).toEqual(freshBox);
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        await expect
          .poll(async () => (await canonical(s.auctionId)).bids.length)
          .toBe(priorCount + 1);
        await settled(s.owner);
        expect(posts).toBe(nativeMouseClicks + 1);
        const completedTrace = await s.owner.evaluate(
          () =>
            (
              window as unknown as {
                gestureTrace: Array<{
                  type: string;
                  id: number;
                  pointer: string;
                  primary: boolean;
                }>;
              }
            ).gestureTrace,
        );
        expect(completedTrace.at(-1)?.type).toBe("click");
        expect(completedTrace.at(-1)?.pointer).toBe("touch");
        await info.attach("native-overlapping-pointers", {
          contentType: "application/json",
          body: JSON.stringify({
            width,
            releaseOrder,
            trace: completedTrace,
            posts,
            canonical: await canonical(s.auctionId),
            markers: await recovery(s.owner),
          }),
        });
        await cdp.detach();
      } finally {
        const diagnosticPath = info.outputPath("overlap-diagnostic.json");
        await writeFile(
          diagnosticPath,
          JSON.stringify(
            {
              trace: await s.owner.evaluate(
                () => (window as unknown as { gestureTrace: unknown }).gestureTrace,
              ),
              canonical: await canonical(s.auctionId),
              markers: await recovery(s.owner),
            },
            null,
            2,
          ),
        );
        await info.attach("overlap-diagnostic", {
          contentType: "application/json",
          path: diagnosticPath,
        });
        await s.ownerContext.close();
        await s.conductorContext.close();
      }
    });
  }
}
