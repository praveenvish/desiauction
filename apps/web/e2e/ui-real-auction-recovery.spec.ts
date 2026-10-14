import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { canonical, recovery, settled, stage } from "./ui-auction-fixtures";

test("a real owner's lost accepted bid remains single while another conductor can actually pause", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const s = await stage(browser);
  try {
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    let posts = 0;
    await s.owner.route(`**/seasons/${s.data.slug}/auction/live`, async (route) => {
      if (
        route.request().method() === "POST" &&
        route.request().postData()?.includes('"PlaceBid"')
      ) {
        posts++;
        await route.fetch();
        await hold;
        await route.abort("failed");
      } else await route.continue();
    });
    await s.owner.getByTestId("bid-next").evaluate((button) => {
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
    });
    await expect.poll(async () => (await canonical(s.auctionId)).bids.length).toBe(1);
    const accepted = (await canonical(s.auctionId)).bids[0];
    if (!accepted) throw new Error("Missing real accepted bid");
    await s.conductor.getByTestId("cockpit-pause").click();
    await expect.poll(async () => (await canonical(s.auctionId)).projection.status).toBe("paused");
    await expect(s.owner.getByTestId("live-status")).toHaveText("paused");
    const before = (await recovery(s.owner)).find((item) => item.type === "PlaceBid");
    if (!before) throw new Error("Missing pending bid identity");
    release();
    await expect(s.owner.getByTestId("auction-command-recovery")).toContainText(
      "Command outcome unknown",
    );
    await s.owner.unrouteAll({ behavior: "wait" });
    await s.owner.reload();
    await expect(s.owner.getByTestId("auction-command-recovery")).toContainText(
      "Command outcome unknown",
    );
    expect(
      (await recovery(s.owner)).find((item) => item.commandId === before.commandId)?.state,
    ).toBe("unknown");
    expect(posts).toBe(1);
    expect((await canonical(s.auctionId)).bids).toHaveLength(1);
    await s.owner
      .getByRole("button", { name: "Reviewed current room · allow a new action" })
      .click();
    await expect(s.owner.getByTestId("auction-command-recovery")).toHaveCount(0);
    await s.conductor.getByTestId("cockpit-resume").click();
    await expect(s.conductor.getByTestId("ribbon-status")).toHaveText("live");
    await settled(s.conductor);
    await s.conductor.getByTestId("cockpit-gavel").hover();
    await s.conductor.mouse.down();
    await s.conductor.waitForTimeout(900);
    await s.conductor.mouse.up();
    await expect
      .poll(
        async () =>
          (await canonical(s.auctionId)).lots.find((lot) => lot.id === accepted.lotId)?.status,
      )
      .toBe("sold");
    await settled(s.conductor);
    const sold = await canonical(s.auctionId);
    expect(sold.lots.find((lot) => lot.id === accepted.lotId)?.soldPrice).toBe(accepted.amount);
    expect(sold.projection.paddles[accepted.paddleId]?.committed).toBe(accepted.amount);
    expect(sold.bids).toHaveLength(1);

    // Actual Undo acknowledgement, followed by an actual held-lot commit
    // whose answer is lost: report the two stages without replaying either.
    let holds = 0;
    let heldRequestFinished = false;
    let holdCommandId = "";
    await s.conductor.route(`**/seasons/${s.data.slug}/auction/cockpit`, async (route) => {
      if (
        route.request().method() === "POST" &&
        route.request().postData()?.includes('"HoldLot"')
      ) {
        holds++;
        const marker = (await recovery(s.conductor)).find(
          (item) => item.type === "HoldLot" && item.state === "prepared",
        );
        if (!marker) throw new Error("Missing exact prepared Hold identity");
        holdCommandId = marker.commandId;
        expect(route.request().postData()).toContain(holdCommandId);
        expect(route.request().postData()).toContain(accepted.lotId);
        await route.fetch();
        await route.abort("failed");
        heldRequestFinished = true;
      } else await route.continue();
    });
    await s.conductor.getByTestId("cockpit-more").click();
    await s.conductor.getByTestId("cockpit-undo").click();
    await s.conductor.getByTestId("confirm-undo").click();
    await expect.poll(() => heldRequestFinished).toBe(true);
    await expect
      .poll(async () =>
        (await recovery(s.conductor)).some(
          (item) =>
            item.commandId === holdCommandId && item.type === "HoldLot" && item.state === "unknown",
        ),
      )
      .toBe(true);
    await expect(s.conductor.getByTestId("auction-command-recovery")).toContainText(
      "Command outcome unknown",
    );
    await s.conductor.unrouteAll({ behavior: "wait" });
    const restored = await canonical(s.auctionId);
    expect(restored.lots.find((lot) => lot.id === accepted.lotId)?.status).toBe("frozen");
    expect(restored.lots.find((lot) => lot.id === accepted.lotId)?.soldPrice).toBeNull();
    expect(restored.projection.paddles[accepted.paddleId]?.committed).toBe(0);
    expect(restored.bids[0]?.status).toBe("invalidated");
    expect(restored.events.filter((event) => event.type === "LotHeld")).toHaveLength(1);
    const holdMarker = (await recovery(s.conductor)).find((item) => item.type === "HoldLot");
    if (!holdMarker) throw new Error("Missing unresolved Hold identity");
    await s.conductor.reload();
    await expect(s.conductor.getByTestId("auction-command-recovery")).toContainText(
      "Command outcome unknown",
    );
    expect(
      (await recovery(s.conductor)).find((item) => item.commandId === holdMarker.commandId)?.state,
    ).toBe("unknown");
    expect(holds).toBe(1);
    expect(
      (await canonical(s.auctionId)).events.filter((event) => event.type === "LotHeld"),
    ).toHaveLength(1);
  } finally {
    await s.conductorContext.close();
    await s.ownerContext.close();
  }
});

test("real refusal, partial requeue and lost completion preserve their distinct outcomes and reason", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const s = await stage(browser);
  let release = () => {};
  try {
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    let received = false;
    let answered = false;
    await s.owner.route(`**/seasons/${s.data.slug}/auction/live`, async (route) => {
      if (
        route.request().method() === "POST" &&
        route.request().postData()?.includes('"PlaceBid"')
      ) {
        received = true;
        await hold;
        const response = await route.fetch();
        answered = true;
        await route.fulfill({ response });
      } else await route.continue();
    });
    await s.owner.getByTestId("bid-next").click();
    await expect.poll(() => received).toBe(true);
    await s.conductor.getByTestId("cockpit-pause").click();
    await expect.poll(async () => (await canonical(s.auctionId)).projection.status).toBe("paused");
    release();
    await expect.poll(() => answered).toBe(true);
    await settled(s.owner);
    await expect(s.owner.getByTestId("auction-command-recovery")).toHaveCount(0);
    expect((await canonical(s.auctionId)).bids).toHaveLength(0);
    await s.owner.unrouteAll({ behavior: "wait" });
    await s.conductor.getByTestId("cockpit-resume").click();
    await expect(s.conductor.getByTestId("ribbon-status")).toHaveText("live");
    await settled(s.conductor);
    for (let index = 1; index <= 3; index++) {
      if (index > 1) await s.conductor.getByTestId(`open-L00${String(index)}`).click();
      await s.conductor.getByTestId("cockpit-gavel").hover();
      await s.conductor.mouse.down();
      await s.conductor.waitForTimeout(900);
      await s.conductor.mouse.up();
      await expect
        .poll(
          async () =>
            (await canonical(s.auctionId)).lots.filter((lot) => lot.status === "unsold").length,
        )
        .toBe(index);
      await settled(s.conductor);
    }
    let requeues = 0;
    await s.conductor.route(`**/seasons/${s.data.slug}/auction/cockpit`, async (route) => {
      if (
        route.request().method() === "POST" &&
        route.request().postData()?.includes('"RequeueLot"')
      ) {
        requeues++;
        const response = await route.fetch();
        if (requeues === 2) await route.abort("failed");
        else await route.fulfill({ response });
      } else await route.continue();
    });
    await s.conductor.getByTestId("requeue-all-unsold").click();
    await expect(s.conductor.getByTestId("auction-command-recovery")).toContainText(
      "Command outcome unknown",
    );
    await expect(s.conductor.getByTestId("auction-command-recovery")).toContainText(
      "1 of 3 players acknowledged as requeued before this item",
    );
    await s.conductor.unrouteAll({ behavior: "wait" });
    expect(requeues).toBe(2);
    let current = await canonical(s.auctionId);
    expect(current.events.filter((event) => event.type === "LotRequeued")).toHaveLength(2);
    expect(current.lots.filter((lot) => lot.status === "unsold")).toHaveLength(1);
    const pending = (await recovery(s.conductor)).find((item) => item.type === "RequeueLot");
    if (!pending) throw new Error("Missing partial batch intent");
    await s.conductor.reload();
    await expect(s.conductor.getByTestId("auction-command-recovery")).toContainText(
      "1 of 3 players acknowledged",
    );
    expect(
      (await recovery(s.conductor)).find((item) => item.commandId === pending.commandId)?.state,
    ).toBe("unknown");
    expect(
      (await canonical(s.auctionId)).events.filter((event) => event.type === "LotRequeued"),
    ).toHaveLength(2);
    await s.conductor
      .getByRole("button", { name: "Reviewed current room · allow a new action" })
      .click();
    await expect(s.conductor.getByTestId("auction-command-recovery")).toHaveCount(0);
    const [remaining] = (await canonical(s.auctionId)).lots.filter(
      (lot) => lot.status === "unsold",
    );
    if (!remaining) throw new Error("Missing unsent third batch item");
    await s.conductor.getByTestId(`requeue-${remaining.lotNumber}`).click();
    await expect
      .poll(
        async () =>
          (await canonical(s.auctionId)).lots.filter((lot) => lot.status === "unsold").length,
      )
      .toBe(0);
    await settled(s.conductor);
    current = await canonical(s.auctionId);
    for (const lot of current.lots.filter((item) => item.status === "queued")) {
      await s.conductor.getByTestId(`withdraw-${lot.lotNumber}`).click();
      await s.conductor.getByTestId("confirm-withdraw").click();
      await expect(s.conductor.getByTestId(`queue-${lot.lotNumber}`)).toHaveCount(0);
      await settled(s.conductor);
    }
    await s.conductor.getByTestId("cockpit-more").click();
    await s.conductor.getByTestId("cockpit-complete").click();
    await s.conductor.getByTestId("confirm-complete").click();
    await expect(s.conductor.getByTestId("override-reason")).toBeVisible();
    await expect(s.conductor.getByTestId("confirm-complete")).toBeDisabled();
    expect((await canonical(s.auctionId)).projection.status).toBe("live");
    await settled(s.conductor);
    const reason = "Isolated recovery rehearsal: intentionally empty squads.";
    await s.conductor.getByTestId("override-reason").fill(reason);
    let completions = 0;
    await s.conductor.route(`**/seasons/${s.data.slug}/auction/cockpit`, async (route) => {
      if (
        route.request().method() === "POST" &&
        route.request().postData()?.includes('"CompleteAuction"')
      ) {
        completions++;
        await route.fetch();
        await route.abort("failed");
      } else await route.continue();
    });
    await s.conductor.getByTestId("confirm-complete").click();
    await expect(s.conductor.getByTestId("auction-command-recovery")).toContainText(
      "Command outcome unknown",
    );
    await expect(s.conductor.getByRole("dialog")).toBeVisible();
    await expect(s.conductor.getByTestId("override-reason")).toHaveValue(reason);
    await expect(s.conductor.getByTestId("confirm-complete")).toBeDisabled();
    await s.conductor.unrouteAll({ behavior: "wait" });
    const completed = await canonical(s.auctionId);
    expect(completed.projection.status).toBe("completed");
    const closed = completed.events.filter((event) => event.type === "AuctionClosed");
    expect(closed).toHaveLength(1);
    const closeAudit = completed.audit.filter((row) => row.action === "auction.AuctionClosed");
    expect(closeAudit).toHaveLength(1);
    expect(closeAudit[0]?.meta).toMatchObject({ reason, eventSeq: String(closed[0]?.seq) });
    expect(closeAudit[0]?.actor).toBe(closed[0]?.actor);
    expect(completions).toBe(1);
    expect(completed.bids).toHaveLength(0);
  } finally {
    release();
    await s.conductorContext.close();
    await s.ownerContext.close();
  }
});

test("a committed Undo with a lost answer stops before Hold and retains the exact unresolved intent", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const s = await stage(browser);
  let release = () => {};
  try {
    await s.owner.getByTestId("bid-next").click();
    await expect.poll(async () => (await canonical(s.auctionId)).bids.length).toBe(1);
    await settled(s.owner);
    const accepted = (await canonical(s.auctionId)).bids[0];
    if (!accepted) throw new Error("Missing accepted bid before Undo");
    await s.conductor.getByTestId("cockpit-gavel").hover();
    await s.conductor.mouse.down();
    await s.conductor.waitForTimeout(900);
    await s.conductor.mouse.up();
    await expect
      .poll(
        async () =>
          (await canonical(s.auctionId)).lots.find((lot) => lot.id === accepted.lotId)?.status,
      )
      .toBe("sold");
    await settled(s.conductor);
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let undos = 0;
    let holds = 0;
    await s.conductor.route(`**/seasons/${s.data.slug}/auction/cockpit`, async (route) => {
      if (route.request().method() === "POST") {
        const payload = route.request().postData() ?? "";
        if (payload.includes('"HoldLot"')) holds++;
        if (payload.includes('"UndoLastAction"')) {
          undos++;
          await route.fetch();
          await gate;
          await route.abort("failed");
          return;
        }
      }
      await route.continue();
    });
    await s.conductor.getByTestId("cockpit-more").click();
    await s.conductor.getByTestId("cockpit-undo").click();
    await expect(s.conductor.getByTestId("undo-held-note")).toContainText("then requests a hold");
    await s.conductor.getByTestId("confirm-undo").click();
    await expect
      .poll(
        async () =>
          (await canonical(s.auctionId)).events.filter((event) => event.type === "LotReopened")
            .length,
      )
      .toBe(1);
    await expect(s.conductor.getByTestId("confirm-undo")).toBeDisabled();
    const pending = (await recovery(s.conductor)).find((item) => item.type === "UndoLastAction");
    if (!pending) throw new Error("Missing Undo identity before lost answer");
    release();
    await expect(s.conductor.getByTestId("auction-command-recovery")).toContainText(
      "Command outcome unknown",
    );
    await expect(s.conductor.getByRole("dialog")).toBeVisible();
    await expect(s.conductor.getByTestId("confirm-undo")).toBeDisabled();
    await s.conductor.unrouteAll({ behavior: "wait" });
    const restored = await canonical(s.auctionId);
    expect(restored.lots.find((lot) => lot.id === accepted.lotId)?.status).toBe("on_block");
    expect(restored.lots.find((lot) => lot.id === accepted.lotId)?.soldPrice).toBeNull();
    expect(restored.projection.paddles[accepted.paddleId]?.committed).toBe(0);
    expect(restored.bids[0]?.status).toBe("invalidated");
    expect(restored.events.filter((event) => event.type === "LotHeld")).toHaveLength(0);
    await s.conductor.reload();
    await expect(s.conductor.getByTestId("auction-command-recovery")).toContainText(
      "Undo the last outcome",
    );
    expect(
      (await recovery(s.conductor)).find((item) => item.commandId === pending.commandId)?.state,
    ).toBe("unknown");
    expect((await recovery(s.conductor)).filter((item) => item.type === "HoldLot")).toHaveLength(0);
    expect(undos).toBe(1);
    expect(holds).toBe(0);
    const afterReload = await canonical(s.auctionId);
    expect(afterReload.events.filter((event) => event.type === "LotReopened")).toHaveLength(1);
    expect(afterReload.events.filter((event) => event.type === "LotHeld")).toHaveLength(0);
  } finally {
    release();
    await s.conductorContext.close();
    await s.ownerContext.close();
  }
});

test("the live conductor completion keeps the audited reason and blocks confirmation after a lost accepted reply", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const s = await stage(browser);
  try {
    await s.conductor.getByTestId("cockpit-gavel").hover();
    await s.conductor.mouse.down();
    await s.conductor.waitForTimeout(900);
    await s.conductor.mouse.up();
    await expect
      .poll(
        async () =>
          (await canonical(s.auctionId)).lots.filter((lot) => lot.status === "unsold").length,
      )
      .toBe(1);
    await settled(s.conductor);
    for (const lot of (await canonical(s.auctionId)).lots.filter(
      (item) => item.status === "queued",
    )) {
      await s.conductor.getByTestId(`withdraw-${lot.lotNumber}`).click();
      await s.conductor.getByTestId("confirm-withdraw").click();
      await expect(s.conductor.getByTestId(`queue-${lot.lotNumber}`)).toHaveCount(0);
      await settled(s.conductor);
    }
    await s.conductor.goto(`/seasons/${s.data.slug}/auction/live`);
    await expect(s.conductor.getByTestId("live-panel")).toHaveAttribute("data-hydrated", "true");
    await settled(s.conductor);
    await s.conductor.getByTestId("conduct-complete").click();
    await s.conductor.getByTestId("confirm-complete").click();
    await expect(s.conductor.getByTestId("override-reason")).toBeVisible();
    await expect(s.conductor.getByTestId("confirm-complete")).toBeDisabled();
    expect((await canonical(s.auctionId)).projection.status).toBe("live");
    await settled(s.conductor);
    const reason = "Isolated live-room test: closing with empty squads on the record.";
    await s.conductor.getByTestId("override-reason").fill(reason);
    let completions = 0;
    await s.conductor.route(`**/seasons/${s.data.slug}/auction/live`, async (route) => {
      if (
        route.request().method() === "POST" &&
        route.request().postData()?.includes('"CompleteAuction"')
      ) {
        completions++;
        await route.fetch();
        await route.abort("failed");
      } else await route.continue();
    });
    await s.conductor.getByTestId("confirm-complete").click();
    await expect(s.conductor.getByTestId("auction-command-recovery")).toContainText(
      "Command outcome unknown",
    );
    await expect(s.conductor.getByRole("dialog")).toBeVisible();
    await expect(s.conductor.getByTestId("override-reason")).toHaveValue(reason);
    await expect(s.conductor.getByTestId("confirm-complete")).toBeDisabled();
    await s.conductor.unrouteAll({ behavior: "wait" });
    const completed = await canonical(s.auctionId);
    expect(completed.projection.status).toBe("completed");
    const closed = completed.events.filter((event) => event.type === "AuctionClosed");
    expect(closed).toHaveLength(1);
    const audit = completed.audit.filter((row) => row.action === "auction.AuctionClosed");
    expect(audit).toHaveLength(1);
    expect(audit[0]?.meta).toMatchObject({ reason, eventSeq: String(closed[0]?.seq) });
    expect(audit[0]?.actor).toBe(closed[0]?.actor);
    expect(completions).toBe(1);
  } finally {
    await s.conductorContext.close();
    await s.ownerContext.close();
  }
});

async function captureAuction(page: Page, name: string) {
  for (const theme of ["daylight", "floodlight"]) {
    await page.evaluate(async (value) => {
      document.documentElement.setAttribute("data-theme", value);
      await document.fonts.ready;
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => {
          resolve();
        }),
      );
      await Promise.all(
        document
          .getAnimations()
          .filter((animation) => animation instanceof CSSTransition)
          .map((animation) => animation.finished.catch(() => undefined)),
      );
    }, theme);
    for (const viewport of [
      { width: 320, height: 740 },
      { width: 390, height: 844 },
      { width: 768, height: 390 },
      { width: 1440, height: 900 },
    ]) {
      await page.setViewportSize(viewport);
      await page.evaluate(() => {
        scrollTo(0, 0);
      });
      const taskPosition = await page.getByTestId("auction-task-context").evaluate((context) => {
        const headers = [...document.querySelectorAll("header")].filter((header) => {
          const position = getComputedStyle(header).position;
          const rect = header.getBoundingClientRect();
          return ["sticky", "fixed"].includes(position) && rect.top <= 1 && rect.bottom > 0;
        });
        return {
          top: context.getBoundingClientRect().top,
          headerBottom: Math.max(
            0,
            ...headers.map((header) => header.getBoundingClientRect().bottom),
          ),
          scrollY,
        };
      });
      await test.info().attach(`${name}-${theme}-${String(viewport.width)}-bounds`, {
        body: JSON.stringify(taskPosition),
        contentType: "application/json",
      });
      expect(taskPosition.scrollY).toBe(0);
      expect(taskPosition.top).toBeGreaterThanOrEqual(taskPosition.headerBottom);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
      expect(
        (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
          .violations,
      ).toEqual([]);
      await page.screenshot({
        path: test.info().outputPath(`${name}-${theme}-${String(viewport.width)}.png`),
        fullPage: true,
      });
    }
  }
}

test("auction task identity, private plan return and recorded replay remain clear in both themes and compact layouts", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const s = await stage(browser, true);
  try {
    await expect(s.owner.getByTestId("auction-task-context")).toContainText("Owner room");
    await expect(s.owner.getByTestId("auction-task-context")).toContainText("LS1 ");
    await s.owner.getByTestId("bid-next").focus();
    await expect(s.owner.getByTestId("bid-next")).toBeFocused();
    await captureAuction(s.owner, "owner-live");
    await expect(s.conductor.getByTestId("auction-task-context")).toContainText("Conductor desk");
    await captureAuction(s.conductor, "conductor-live");
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 1440, height: 900 },
    ]) {
      for (const [page, id, name] of [
        [s.owner, "bid-next", "owner"],
        [s.conductor, "cockpit-gavel", "conductor"],
      ] as const) {
        await page.setViewportSize(viewport);
        await page.evaluate(() => {
          scrollTo(0, 240);
        });
        const control = page.getByTestId(id);
        await control.scrollIntoViewIfNeeded();
        const bounds = await control.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          const hit = document.elementFromPoint(
            rect.left + rect.width / 2,
            rect.top + rect.height / 2,
          );
          return {
            scrollY,
            rect: rect.toJSON() as unknown,
            reachable: hit !== null && element.contains(hit),
          };
        });
        expect(bounds.reachable).toBe(true);
        await test.info().attach(`${name}-${String(viewport.width)}-scrolled-bounds`, {
          body: JSON.stringify(bounds),
          contentType: "application/json",
        });
        await page.screenshot({
          path: test.info().outputPath(`${name}-${String(viewport.width)}-scrolled.png`),
        });
      }
    }
    await s.owner.setViewportSize({ width: 390, height: 844 });
    await s.owner.getByTestId("open-plan").click();
    await expect(s.owner.getByTestId("plan-panel")).toHaveAttribute("data-hydrated", "true");
    await expect(s.owner.getByTestId("auction-task-context")).toContainText("Team owner");
    await expect(
      s.owner.getByText("Only you and this team's other owners can see it.", { exact: false }),
    ).toBeVisible();
    await s.owner.getByTestId("plan-search").fill("Home player 2");
    await s.owner
      .getByTestId(/^plan-add-/)
      .filter({ hasText: "Add" })
      .first()
      .click();
    await expect(s.owner.getByTestId(/^plan-target-/)).toHaveCount(1);
    await captureAuction(s.owner, "owner-private-plan");
    await s.owner.getByTestId("plan-open-live").focus();
    await expect(s.owner.getByTestId("plan-open-live")).toBeFocused();
    await s.owner.getByTestId("plan-open-live").press("Enter");
    await expect(s.owner.getByTestId("live-panel")).toHaveAttribute("data-hydrated", "true");
    await s.owner.getByTestId("open-plan").click();
    await expect(s.owner.getByTestId(/^plan-target-/)).toHaveCount(1);
    await s.conductor.goto(`/seasons/${s.data.slug}/auction/replay`);
    await expect(s.conductor.getByTestId("replay-panel")).toHaveAttribute("data-hydrated", "true");
    await expect(s.conductor.getByTestId("auction-task-context")).toContainText("Recorded auction");
    await captureAuction(s.conductor, "recorded-replay");
    await s.conductor.getByRole("button", { name: "Back to the start", exact: true }).focus();
    await expect(
      s.conductor.getByRole("button", { name: "Back to the start", exact: true }),
    ).toBeFocused();
    await s.conductor
      .getByRole("button", { name: "Back to the start", exact: true })
      .press("Enter");
    await expect(s.conductor.getByTestId("replay-position")).toContainText("0");
    await s.conductor.getByRole("link", { name: "Back to cockpit", exact: true }).click();
    await expect(s.conductor.getByTestId("cockpit-panel")).toHaveAttribute("data-hydrated", "true");
    expect((await canonical(s.auctionId)).bids).toHaveLength(0);
    expect((await canonical(s.auctionId)).projection.status).toBe("live");
  } finally {
    await s.conductorContext.close();
    await s.ownerContext.close();
  }
});
