import { expect, it } from "vitest";
import { inAppBrowser } from "./in-app-gate";
it.each([
  ["Mozilla WhatsApp/2.0", "WhatsApp"],
  ["Mozilla Instagram 400", "Instagram"],
  ["Mozilla [FBAN/FBIOS;FBAV/500]", "Facebook"],
  ["Mozilla FBAV/400", "Facebook"],
  ["Mozilla Chrome/140 Safari/537", null],
  ["Mozilla iPhone Safari/600", null],
  ["", null],
])("recognises scorer browser %s", (ua, expected) => {
  expect(inAppBrowser(ua)).toBe(expected);
});
