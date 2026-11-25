/** The size icons are stored with, like KeePassXC does. */
export const ICON_SIZE = 32;

/**
 * Reads a blob as a data URL; the page's security policy allows data URLs for images but not blob URLs.
 * @param blob - The image data.
 */
function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise(/**
   * Reads the blob.
   * @param resolve - Receives the data URL.
   * @param reject - Receives a read error.
   */ (resolve, reject) => {
    const reader = new FileReader();
    reader.onload = /** Returns the result. */ () => resolve(String(reader.result));
    reader.onerror = /** Reports the read error. */ () => reject(reader.error ?? new Error('The icon could not be read.'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Converts any image the browser can show (ICO, PNG, SVG, …) into a square PNG of {@link ICON_SIZE} pixels for the
 * vault's custom icons. The image is loaded from a data URL, so the canvas stays readable.
 * @param blob - The downloaded icon.
 */
export async function iconToPng(blob: Blob): Promise<Uint8Array> {
  const url = await readAsDataUrl(blob);
  const image = new Image();
  image.decoding = 'async';
  image.src = url;
  try {
    await image.decode();
  } catch {
    throw new Error('The website icon is not an image your browser can read.');
  }
  const canvas = document.createElement('canvas');
  canvas.width = ICON_SIZE;
  canvas.height = ICON_SIZE;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Your browser cannot convert images.');
  const scale = Math.min(ICON_SIZE / (image.naturalWidth || ICON_SIZE), ICON_SIZE / (image.naturalHeight || ICON_SIZE));
  const width = (image.naturalWidth || ICON_SIZE) * scale;
  const height = (image.naturalHeight || ICON_SIZE) * scale;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, (ICON_SIZE - width) / 2, (ICON_SIZE - height) / 2, width, height);
  const png = await new Promise<Blob | null>(/**
   * Encodes the canvas as PNG.
   * @param resolve - Receives the PNG blob.
   */ (resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!png) throw new Error('The icon could not be converted.');
  return new Uint8Array(await png.arrayBuffer());
}
