/**
 * Normalize a captured/selected image for upload:
 *  - applies EXIF orientation and re-encodes, which STRIPS the EXIF
 *    orientation tag (the iOS pitfall — otherwise the server sees a
 *    sideways image; spec §6).
 *  - downscales the long edge so uploads stay small on mobile data.
 * Returns a fresh JPEG Blob.
 */
const MAX_EDGE = 2000;
const JPEG_QUALITY = 0.9;

export async function toUploadBlob(file: File | Blob): Promise<Blob> {
  // `imageOrientation: "from-image"` bakes EXIF rotation into the pixels.
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });

  let { width, height } = bitmap;
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
  width = Math.round(width * scale);
  height = Math.round(height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new Error("Couldn't process the image.");
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("Couldn't encode the image.")),
      "image/jpeg",
      JPEG_QUALITY,
    );
  });
}
