import type { LauncherHighlightThemeId } from "@types";

export interface HighlightThemeOption {
  id: LauncherHighlightThemeId;
  name: string;
  subtitle: string;
  primary: string;
  secondary: string;
}

export const HIGHLIGHT_THEME_OPTIONS: HighlightThemeOption[] = [
  {
    id: "cerberus",
    name: "Cerberus (Padrão)",
    subtitle: "Destaque original do Cerberus",
    primary: "#16b195",
    secondary: "#30edc5",
  },
  {
    id: "electricPurple",
    name: "Electric Purple",
    subtitle: "NxNative Signature Violet",
    primary: "#6F31FF",
    secondary: "#8B5CF6",
  },
  {
    id: "nintendoRed",
    name: "Switch Neon Red",
    subtitle: "Classic Joy-Con Red",
    primary: "#E60012",
    secondary: "#FF4B55",
  },
  {
    id: "neonBlue",
    name: "Switch Neon Blue",
    subtitle: "Classic Joy-Con Blue",
    primary: "#0084FF",
    secondary: "#00C2FF",
  },
  {
    id: "emeraldGreen",
    name: "Emerald Green",
    subtitle: "Vibrant Cyber Emerald",
    primary: "#10B981",
    secondary: "#34D399",
  },
  {
    id: "sunsetOrange",
    name: "Sunset Orange",
    subtitle: "Warm Solar Accent",
    primary: "#F97316",
    secondary: "#FB923C",
  },
  {
    id: "cyberRose",
    name: "Cyber Rose",
    subtitle: "Neon Magenta & Pink",
    primary: "#EC4899",
    secondary: "#F472B6",
  },
  {
    id: "hyruleGold",
    name: "Hyrule Gold",
    subtitle: "Royal Triforce Amber",
    primary: "#D97706",
    secondary: "#F59E0B",
  },
  {
    id: "deepCobalt",
    name: "Deep Cobalt",
    subtitle: "Clean macOS Sapphire",
    primary: "#3B82F6",
    secondary: "#60A5FA",
  },
  {
    id: "neonBlack",
    name: "Neon Black",
    subtitle: "Stealth Onyx & Silver",
    primary: "#8E92A0",
    secondary: "#D0D1D7",
  },
];

function hexToRgbString(hex: string): string {
  const clean = hex.replace("#", "").trim();
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return "22, 177, 149";
  const r = Number.parseInt(full.slice(0, 2), 16);
  const g = Number.parseInt(full.slice(2, 4), 16);
  const b = Number.parseInt(full.slice(4, 6), 16);
  return `${r}, ${g}, ${b}`;
}

export function applyHighlightTheme(
  themeId?: LauncherHighlightThemeId | null,
  customHex?: string | null
): void {
  const root = document.documentElement;
  const resolvedId: LauncherHighlightThemeId = themeId || "cerberus";

  if (resolvedId === "cerberus") {
    root.removeAttribute("data-highlight-theme");
    root.style.setProperty("--color-primary", "#16b195");
    root.style.setProperty("--color-accent", "#16b195");
    root.style.setProperty("--color-accent-secondary", "#30edc5");
    root.style.setProperty("--color-accent-rgb", "22, 177, 149");
    return;
  }

  const preset = HIGHLIGHT_THEME_OPTIONS.find((t) => t.id === resolvedId);
  const primary =
    resolvedId === "custom" && customHex
      ? customHex
      : preset?.primary || "#16b195";
  const secondary =
    resolvedId === "custom" && customHex
      ? customHex
      : preset?.secondary || primary;

  root.setAttribute("data-highlight-theme", resolvedId);
  root.style.setProperty("--color-primary", primary);
  root.style.setProperty("--color-accent", primary);
  root.style.setProperty("--color-accent-secondary", secondary);
  root.style.setProperty("--color-accent-rgb", hexToRgbString(primary));
}
