// Resize before sending bytes over the network; the server validates again.
export async function optimizeImage(file: File): Promise<Blob> {
  if (file.size > 20 * 1024 * 1024)
    throw new Error("Choose an image smaller than 20 MiB.");
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context)
      throw new Error("Image resizing is unavailable in this browser.");
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (value) =>
          value
            ? resolve(value)
            : reject(new Error("Could not prepare this image.")),
        "image/jpeg",
        0.84,
      ),
    );
    if (blob.size > 2 * 1024 * 1024)
      throw new Error("This image is still too large. Choose a smaller image.");
    return blob;
  } finally {
    bitmap.close();
  }
}
