// Deteksi platform untuk label shortcut & perilaku modifier.
export const IS_MAC =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** Label modifier utama untuk tooltip shortcut (mis. "⌘" di macOS, "Ctrl" di lainnya). */
export const MOD_KEY = IS_MAC ? "⌘" : "Ctrl";
