/**
 * A PICTURE OF WHAT THEY WERE LOOKING AT (FR-1 Phase 1).
 *
 * Rendered in the browser from the DOM by `modern-screenshot`, which is bundled
 * — no third-party script, so the CSP is untouched — and loaded only when
 * somebody actually opens the report dialog.
 *
 * WHAT IS LEFT OUT, AND HOW.
 *
 *   · The report dialog itself, and anything else marked
 *     `data-report-problem-exclude`, is filtered out of the render.
 *   · Anything matching PRIVATE_SELECTOR (`data-private`, the console's phone
 *     spans, tel:/mailto: links, password/phone/email inputs) has its
 *     characters replaced IN THE CLONE, never on the live page — the person does
 *     not watch their screen flicker, and a failed capture cannot leave the page
 *     half-redacted.
 *
 * This is a floor, not a guarantee, which is why the person sees the picture
 * before it is sent and can remove it. The dialog says so.
 *
 * ONLY THE VIEWPORT. A full-page render of a long registrations table is a
 * megabyte of rows nobody asked about; what they were looking at is the screen.
 */

export const EXCLUDE_ATTRIBUTE = "data-report-problem-exclude";
export const PRIVATE_ATTRIBUTE = "data-private";

/** Kept under the server's 1 MB ceiling with room for multipart overhead. */
const TARGET_BYTES = 900 * 1024;
const MAX_WIDTH = 1440;

/**
 * What gets painted over besides `data-private`. The contact spans the console
 * already renders under shared class names — rosters, registrations, members,
 * the admin user list — and every phone and mail link, wherever it sits. Named
 * here rather than threaded as attributes through five panels, so a panel that
 * renders a phone under one of these classes is covered without knowing this
 * feature exists. `server/support/problem-reports.test.ts` pins the classes against the source.
 */
export const PRIVATE_SELECTOR = [
  `[${PRIVATE_ATTRIBUTE}]`,
  ".registration-phone",
  ".od-member-phone",
  'a[href^="tel:"]',
  'a[href^="mailto:"]',
  'input[type="password"]',
  'input[type="tel"]',
  'input[type="email"]',
].join(", ");

/**
 * Blank one element IN THE CLONE: every character becomes a bullet and the box
 * is painted grey. Replacing the characters is the part that matters — a first
 * version only set the text colour to transparent, and the renderer drew the
 * numbers anyway (caught by looking at a real capture of the registrations
 * table). Bullets keep roughly the same width, so the layout in the picture
 * still matches what the person saw.
 */
function mask(element: Element): void {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    element.value = "";
    element.setAttribute("value", "");
    element.setAttribute("placeholder", "");
  }
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  for (let text = walker.nextNode(); text !== null; text = walker.nextNode()) {
    text.nodeValue = (text.nodeValue ?? "").replace(/\S/g, "•");
  }
  if (element instanceof HTMLElement) {
    element.style.setProperty("background", "#8a8f98", "important");
    element.style.setProperty("color", "#8a8f98", "important");
    element.style.setProperty("border-radius", "4px", "important");
  }
}

/** Runs once over the whole cloned tree, after it is built and before it is drawn. */
function maskClone(root: Node): void {
  if (!(root instanceof Element)) {
    return;
  }
  if (root.matches(PRIVATE_SELECTOR)) {
    mask(root);
  }
  for (const element of Array.from(root.querySelectorAll(PRIVATE_SELECTOR))) {
    mask(element);
  }
}

async function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", quality);
  });
}

/**
 * Capture the visible viewport as a JPEG. Resolves null on any failure — a
 * report without a picture is still a report.
 */
export async function captureViewport(): Promise<Blob | null> {
  try {
    const { domToCanvas } = await import("modern-screenshot");
    const width = window.innerWidth;
    const height = window.innerHeight;
    const scale = Math.min(1, MAX_WIDTH / width) * Math.min(window.devicePixelRatio || 1, 1.5);
    const background = getComputedStyle(document.body).backgroundColor;

    const canvas = await domToCanvas(document.body, {
      width,
      height,
      scale,
      backgroundColor: background === "rgba(0, 0, 0, 0)" ? "#ffffff" : background,
      // Shift the render so the part of the page on screen is what lands in
      // the frame, rather than the top of the document.
      style: {
        transform: `translate(${String(-window.scrollX)}px, ${String(-window.scrollY)}px)`,
        transformOrigin: "top left",
      },
      filter: (node) => !(node instanceof Element && node.hasAttribute(EXCLUDE_ATTRIBUTE)),
      onCloneNode: maskClone,
      timeout: 8000,
    });

    for (const quality of [0.72, 0.5, 0.35]) {
      const blob = await toBlob(canvas, quality);
      if (blob !== null && blob.size <= TARGET_BYTES) {
        return blob;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * An image the person chose instead — often a phone screenshot, which is three
 * megabytes of PNG. Redrawn to a JPEG under the same ceiling, so "attach your
 * own" does not fail on the size limit the automatic one was built to respect.
 */
export async function shrinkImageFile(file: File): Promise<Blob | null> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
    return null;
  }
  try {
    const bitmap = await createImageBitmap(file);
    const ratio = Math.min(1, MAX_WIDTH / bitmap.width);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * ratio);
    canvas.height = Math.round(bitmap.height * ratio);
    const context = canvas.getContext("2d");
    if (context === null) {
      return null;
    }
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    for (const quality of [0.8, 0.6, 0.4]) {
      const blob = await toBlob(canvas, quality);
      if (blob !== null && blob.size <= TARGET_BYTES) {
        return blob;
      }
    }
    return null;
  } catch {
    return null;
  }
}
