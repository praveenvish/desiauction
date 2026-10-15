import { expect, test, type WebSocketRoute } from "@playwright/test";
import { canonical, settled, stage } from "./ui-auction-fixtures";
for (const width of [390, 1440]) {
  test(`routine pending and accepted statuses preserve room layout at ${String(width)}px`, async ({
    browser,
  }) => {
    const s = await stage(browser);
    let release!: () => void;
    const responseReady = new Promise<void>((resolve) => {
      release = resolve;
    });
    const frames: Array<{ socket: WebSocketRoute; message: string | Buffer }> = [];
    let hold = false;
    const diagnostics: unknown[] = [];
    try {
      await s.owner.setViewportSize({ width, height: 900 });
      await s.owner.routeWebSocket("**/*", (socket) => {
        const server = socket.connectToServer();
        server.onMessage((message) => {
          if (hold) frames.push({ socket, message });
          else socket.send(message);
        });
      });
      await s.owner.reload();
      await expect(s.owner.getByTestId("live-panel")).toHaveAttribute("data-hydrated", "true");
      await settled(s.owner);
      await expect(s.owner.getByTestId("bid-next")).toBeEnabled();
      await s.owner.getByTestId("bid-next").hover();
      const position = () =>
        s.owner
          .locator("#live-top")
          .evaluate((node) => ({ top: node.getBoundingClientRect().top, scrollY }));
      const before = await position();
      diagnostics.push({ phase: "before", ...before });
      await s.owner.route(`**/seasons/${s.data.slug}/auction/live`, async (route) => {
        if (
          route.request().method() === "POST" &&
          route.request().postData()?.includes('"PlaceBid"')
        ) {
          const response = await route.fetch();
          await responseReady;
          await route.fulfill({ response });
        } else await route.continue();
      });
      hold = true;
      await s.owner.getByTestId("bid-next").click();
      const status = s.owner.getByTestId("auction-command-status");
      await expect(status).toHaveAttribute("data-presentation", "pending");
      await expect.poll(async () => (await canonical(s.auctionId)).bids.length).toBe(1);
      const pending = await position();
      diagnostics.push({
        phase: "pending",
        ...pending,
        commands: await status.getAttribute("data-command-states"),
      });
      expect(pending).toEqual(before);
      await expect(s.owner.getByTestId("auction-command-recovery")).toHaveCount(0);
      release();
      await expect(status).toHaveAttribute("data-presentation", "accepted");
      const accepted = await position();
      diagnostics.push({
        phase: "accepted",
        ...accepted,
        commands: await status.getAttribute("data-command-states"),
      });
      expect(accepted).toEqual(before);
      await expect(s.owner.getByTestId("bid-next")).toBeDisabled();
      hold = false;
      for (const frame of frames.splice(0)) frame.socket.send(frame.message);
      await expect(status).toHaveAttribute("data-presentation", "idle");
      await settled(s.owner);
      const observed = await position();
      diagnostics.push({ phase: "observed", ...observed });
      expect(observed).toEqual(before);
      expect((await canonical(s.auctionId)).bids).toHaveLength(1);
    } finally {
      release();
      hold = false;
      for (const frame of frames.splice(0)) frame.socket.send(frame.message);
      await test.info().attach("presentation-phases", {
        body: JSON.stringify(diagnostics),
        contentType: "application/json",
      });
      await s.owner.unrouteAll({ behavior: "wait" });
      await s.conductorContext.close();
      await s.ownerContext.close();
    }
  });
}
