/**
 * MAKE A PHONE PHOTO FIT.
 *
 * A player photo is shown at card size, but it arrives straight off a phone
 * camera — 3 to 8 MB, 4000 pixels wide — and the upload refuses anything over
 * 5 MB. In a Google Form batch that was a steady trickle of "larger than 5 MB"
 * rows the organizer could do nothing about. Now the browser redraws the
 * picture at a sensible size before upload, keeping its orientation.
 *
 * It never makes things worse: a small file is left alone, and if the redraw
 * comes out no smaller (or the browser cannot read the format at all), the
 * original is returned and the upload's own checks decide.
 */

/** Longest edge after shrinking — twice the largest size any card draws. */
const MAX_EDGE = 1600;
/** Below this a file is already fine as it is. */
const SMALL_ENOUGH = 1024 * 1024;

export async function shrinkImage(file: File): Promise<File> {
  const convertible = /^image\/(heic|heif)$/.test(file.type);
  if (file.size <= SMALL_ENOUGH && !convertible) {
    return file;
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return file;
  }
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext("2d");
  if (context === null) {
    bitmap.close();
    return file;
  }
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", 0.85);
  });
  // A HEIC that decoded is worth keeping as JPEG even if it did not shrink:
  // the upload does not accept HEIC at all.
  if (blob === null || (blob.size >= file.size && !convertible)) {
    return file;
  }
  const stem = file.name.replace(/\.[^.]+$/, "");
  return new File([blob], `${stem}.jpg`, { type: "image/jpeg" });
}
