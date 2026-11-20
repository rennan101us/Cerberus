export type DepotPromptKind =
  | "username"
  | "password"
  | "steam-guard"
  | "email-code";

export interface DepotDownloaderLineEvent {
  progress?: number;
  qrUrl?: string;
  prompt?: DepotPromptKind;
  message?: string;
  totalBytes?: number;
}

const PROGRESS_RE = /^\s*(\d{1,3}(?:\.\d+)?)%\s+(.+)?$/;
const QR_URL_RE = /(https:\/\/s\.team\/q\/\S+)/i;
const DOWNLOAD_COMPLETE_TOTAL_RE = /Total downloaded:\s*([\d,]+)\s+bytes/i;

export function parseDepotDownloaderLine(
  rawLine: string
): DepotDownloaderLineEvent {
  const line = rawLine.trim();
  if (!line) return {};

  const event: DepotDownloaderLineEvent = { message: line };

  const qrMatch = QR_URL_RE.exec(line);
  if (qrMatch) {
    event.qrUrl = qrMatch[1].replace(/[),.;]+$/, "");
    event.prompt = "steam-guard";
    return event;
  }

  const lower = line.toLowerCase();
  if (
    lower.includes("enter your 2fa code") ||
    lower.includes("authenticator code") ||
    (lower.includes("steam guard") && lower.includes("app")) ||
    lower.includes("mobile authenticator")
  ) {
    event.prompt = "steam-guard";
    return event;
  }

  if (
    lower.includes("auth code") ||
    (lower.includes("email") && lower.includes("code"))
  ) {
    event.prompt = "email-code";
    return event;
  }

  if (lower.includes("enter account password") || lower.endsWith("password:")) {
    event.prompt = "password";
    return event;
  }

  if (lower.includes("enter account username") || lower.includes("username:")) {
    event.prompt = "username";
    return event;
  }

  const pctMatch = PROGRESS_RE.exec(line);
  if (pctMatch) {
    const pct = Number(pctMatch[1]);
    if (Number.isFinite(pct)) {
      event.progress = Math.max(0, Math.min(1, pct / 100));
    }
    return event;
  }

  const totalMatch = DOWNLOAD_COMPLETE_TOTAL_RE.exec(line);
  if (totalMatch) {
    const numeric = Number(totalMatch[1].replace(/,/g, ""));
    if (Number.isFinite(numeric)) {
      event.totalBytes = numeric;
      event.progress = 1;
    }
  }

  return event;
}
