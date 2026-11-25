export function cleanSignaturePixels(source, width, height) {
  if (!(source instanceof Uint8ClampedArray) || source.length !== width * height * 4 || width < 1 || height < 1) {
    throw new Error('A valid image pixel buffer is required.');
  }
  const pixels = new Uint8ClampedArray(source);
  let left = width, top = height, right = -1, bottom = -1;
  for (let i = 0; i < pixels.length; i += 4) {
    const brightness = (pixels[i] * 0.299) + (pixels[i + 1] * 0.587) + (pixels[i + 2] * 0.114);
    const alpha = Math.max(0, Math.min(255, Math.round((238 - brightness) * 2.2)));
    pixels[i] = 28; pixels[i + 1] = 35; pixels[i + 2] = 62; pixels[i + 3] = alpha;
    if (alpha > 24) {
      const pixel = i / 4, x = pixel % width, y = Math.floor(pixel / width);
      left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
  }
  if (right < left || bottom < top) throw new Error('No dark handwritten marks were found. Use a clear photo or scan of the signature.');
  return { pixels, bounds: { left, top, right, bottom } };
}
