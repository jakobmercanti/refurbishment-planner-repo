import { completed, localDatabase, requestValue } from "./localDatabase";

export const MAX_ELECTRICAL_IMAGE_BYTES = 5 * 1024 * 1024;
const safeAttachmentId = /^[\w:-]{1,150}$/;

function imageType(bytes: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)) return "image/png";
  if (String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

export function validateElectricalImageBytes(bytes: Uint8Array, expectedType: string): boolean {
  return imageType(bytes) === expectedType;
}

export async function validateElectricalImage(file: File): Promise<"image/jpeg" | "image/png" | "image/webp"> {
  if (file.size <= 0 || file.size > MAX_ELECTRICAL_IMAGE_BYTES) throw new Error("Choose an image smaller than 5 MB.");
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("Use a JPEG, PNG or WEBP image.");
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const detected = imageType(bytes);
  if (!detected || detected !== file.type) throw new Error("The selected file does not match its image type.");
  return detected;
}

export async function storeElectricalImage(id: string, file: File): Promise<{ mediaType: "image/jpeg" | "image/png" | "image/webp"; sizeBytes: number; fileName: string }> {
  if (!safeAttachmentId.test(id)) throw new Error("Invalid electrical attachment ID.");
  const mediaType = await validateElectricalImage(file);
  const blob = new Blob([await file.arrayBuffer()], { type: mediaType });
  const db = await localDatabase();
  const transaction = db.transaction("electricalAttachments", "readwrite");
  const done = completed(transaction);
  transaction.objectStore("electricalAttachments").put({ blob, mediaType, sizeBytes: file.size }, id);
  await done;
  return { mediaType, sizeBytes: file.size, fileName: file.name.split(/[\\/]/).at(-1)?.replace(/[^\w.-]/g, "_").slice(0, 120) ?? "image" };
}

export async function getElectricalImage(id: string): Promise<Blob> {
  if (!safeAttachmentId.test(id)) throw new Error("Invalid electrical attachment ID.");
  const db = await localDatabase();
  const record = await requestValue(db.transaction("electricalAttachments").objectStore("electricalAttachments").get(id)) as { blob?: Blob } | undefined;
  if (!(record?.blob instanceof Blob)) throw new Error("An electrical reference picture is missing from local storage.");
  return record.blob;
}

export async function storeElectricalImageBlob(id: string, blob: Blob, fileName: string, mediaType: string): Promise<void> {
  if (!safeAttachmentId.test(id) || blob.size <= 0 || blob.size > MAX_ELECTRICAL_IMAGE_BYTES) throw new Error("Electrical picture exceeds the storage limit.");
  if (!["image/jpeg", "image/png", "image/webp"].includes(mediaType)) throw new Error("Unsupported electrical picture type.");
  const detected = imageType(new Uint8Array(await blob.slice(0, 12).arrayBuffer()));
  if (detected !== mediaType || blob.type && blob.type !== mediaType) throw new Error("Electrical picture content does not match its declared type.");
  const db = await localDatabase();
  const transaction = db.transaction("electricalAttachments", "readwrite");
  const done = completed(transaction);
  transaction.objectStore("electricalAttachments").put({ blob: new Blob([await blob.arrayBuffer()], { type: mediaType }), mediaType, sizeBytes: blob.size, fileName: fileName.slice(0, 120) }, id);
  await done;
}

export async function storeElectricalImageBlobs(images: Array<{ id: string; blob: Blob; fileName: string; mediaType: string }>): Promise<void> {
  if (images.length > 30) throw new Error("An electrical layout can contain up to 30 reference pictures.");
  for (const image of images) {
    if (!safeAttachmentId.test(image.id) || image.blob.size <= 0 || image.blob.size > MAX_ELECTRICAL_IMAGE_BYTES) throw new Error("An electrical picture exceeds the storage limit.");
    if (!["image/jpeg", "image/png", "image/webp"].includes(image.mediaType)) throw new Error("Unsupported electrical picture type.");
    if (image.blob.type && image.blob.type !== image.mediaType || !validateElectricalImageBytes(new Uint8Array(await image.blob.slice(0, 12).arrayBuffer()), image.mediaType)) throw new Error("Electrical picture content does not match its declared type.");
  }
  if (!images.length) return;
  const prepared = await Promise.all(images.map(async (image) => ({ ...image, bytes: await image.blob.arrayBuffer() })));
  const db = await localDatabase();
  const transaction = db.transaction("electricalAttachments", "readwrite");
  const done = completed(transaction);
  for (const image of prepared) transaction.objectStore("electricalAttachments").put({ blob: new Blob([image.bytes], { type: image.mediaType }), mediaType: image.mediaType, sizeBytes: image.blob.size, fileName: image.fileName.slice(0, 120) }, image.id);
  await done;
}
