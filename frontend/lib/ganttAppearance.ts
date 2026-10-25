/** Render-only contrast. Activity colours and progress values remain unchanged. */
export function ganttBarAppearance(colour: string) {
  const hex = /^#[0-9a-f]{6}$/i.test(colour) ? colour : "#287fb8";
  const linear = [1, 3, 5].map(offset => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance = linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  const darkText = (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05);
  return {
    foreground: darkText ? "#000000" : "#ffffff",
    // Progress must increase, not reduce, contrast beneath the same label.
    progressOverlay: darkText ? "rgb(255 255 255 / 22%)" : "rgb(0 0 0 / 22%)",
    textShadow: darkText ? "none" : "0 1px 2px rgb(0 0 0 / 32%)",
  };
}
