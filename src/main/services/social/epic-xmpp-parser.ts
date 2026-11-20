import type { SocialGameInvite } from "@types";

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function unescapeXml(value: string): string {
  return value
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}

export interface EpicXmppPresence {
  accountId: string;
  isOnline: boolean;
  gameTitle: string | null;
  appId: string | null;
  joinable: boolean;
  partyId: string | null;
  statusText: string | null;
}

export interface EpicXmppMessage {
  kind: "chat" | "invite" | "unknown";
  fromAccountId: string;
  body: string;
  invite?: SocialGameInvite;
}

const getAttr = (tag: string, name: string): string | null => {
  const match = new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(tag);
  return match ? match[1] : null;
};

const extractAccountFromJid = (jid: string | null): string => {
  if (!jid) return "";
  return jid.split("@")[0].split("/")[0].trim();
};

const extractTagBody = (stanza: string, tagName: string): string | null => {
  const re = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)</${tagName}>`, "i");
  const match = re.exec(stanza);
  return match ? unescapeXml(match[1]) : null;
};

export function parseEpicPresenceStanza(stanza: string): EpicXmppPresence | null {
  const openTagMatch = /<presence\b([^>]*)>/i.exec(stanza);
  if (!openTagMatch) return null;

  const accountId = extractAccountFromJid(getAttr(openTagMatch[1], "from"));
  if (!accountId) return null;

  const typeAttr = getAttr(openTagMatch[1], "type");
  if (typeAttr === "unavailable") {
    return {
      accountId,
      isOnline: false,
      gameTitle: null,
      appId: null,
      joinable: false,
      partyId: null,
      statusText: null,
    };
  }

  const rawStatus = extractTagBody(stanza, "status");
  let gameTitle: string | null = null;
  let appId: string | null = null;
  let joinable = false;
  let partyId: string | null = null;
  let statusText: string | null = rawStatus;

  if (rawStatus && rawStatus.trim().startsWith("{")) {
    try {
      const json = JSON.parse(rawStatus) as Record<string, unknown>;
      statusText = typeof json.Status === "string" ? json.Status : null;
      const productName =
        typeof json.ProductName === "string" ? json.ProductName : null;
      const bIsPlaying = Boolean(json.bIsPlaying);
      joinable = Boolean(json.bIsJoinable);

      const props = (json.Properties ?? {}) as Record<string, unknown>;
      for (const [key, val] of Object.entries(props)) {
        if (key.includes("party.joininfodata") && val && typeof val === "object") {
          const joinData = val as Record<string, unknown>;
          if (typeof joinData.partyId === "string") partyId = joinData.partyId;
          if (typeof joinData.appId === "string") appId = joinData.appId;
          joinable = true;
        }
        if (typeof val === "string" && !appId && key.toLowerCase().includes("appid")) {
          appId = val;
        }
      }

      if (productName && productName !== "Launcher") {
        gameTitle = productName;
      } else if (bIsPlaying && statusText) {
        gameTitle = statusText;
      }
    } catch {
      // keep raw status
    }
  }

  return {
    accountId,
    isOnline: true,
    gameTitle,
    appId,
    joinable,
    partyId,
    statusText,
  };
}

export function parseEpicMessageStanza(
  stanza: string,
  nowIso: string = new Date().toISOString()
): EpicXmppMessage | null {
  const openTagMatch = /<message\b([^>]*)>/i.exec(stanza);
  if (!openTagMatch) return null;

  const msgType = getAttr(openTagMatch[1], "type") || "";
  if (msgType === "error") return null;

  const fromAccountId = extractAccountFromJid(getAttr(openTagMatch[1], "from"));
  const rawBody = extractTagBody(stanza, "body");
  if (!fromAccountId || rawBody === null) return null;

  if (rawBody.trim().startsWith("{")) {
    try {
      const payload = JSON.parse(rawBody) as Record<string, unknown>;
      const evtType = typeof payload.type === "string" ? payload.type : "";
      if (
        evtType.includes("party.notification") ||
        evtType.includes("INVITE") ||
        evtType.includes("PING")
      ) {
        const inner = (payload.payload ?? payload) as Record<string, unknown>;
        const partyId =
          typeof inner.party_id === "string"
            ? inner.party_id
            : typeof inner.partyId === "string"
              ? inner.partyId
              : undefined;
        const appId =
          typeof inner.appId === "string"
            ? inner.appId
            : typeof inner.namespace === "string"
              ? inner.namespace
              : undefined;
        const gameTitle =
          typeof inner.gameTitle === "string"
            ? inner.gameTitle
            : appId || "Fortnite / Epic Game";

        return {
          kind: "invite",
          fromAccountId,
          body: `Convite para jogar ${gameTitle}`,
          invite: {
            id: `epic-inv-${Date.now()}`,
            provider: "epic",
            appId,
            gameTitle,
            partyId,
            inviterId: `epic:${fromAccountId}`,
            createdAt: nowIso,
            status: "pending",
          },
        };
      }
      return { kind: "unknown", fromAccountId, body: rawBody };
    } catch {
      // treat as text message
    }
  }

  const cerbMatch = /^\[Convite Epic:\s*(.+?)\](?:\s*\(App:\s*([^)]+)\))?/i.exec(
    rawBody.trim()
  );
  if (cerbMatch) {
    const gameTitle = cerbMatch[1].trim();
    const appId = cerbMatch[2]?.trim();
    return {
      kind: "invite",
      fromAccountId,
      body: `Convite para jogar ${gameTitle}`,
      invite: {
        id: `epic-inv-${Date.now()}`,
        provider: "epic",
        appId,
        gameTitle,
        inviterId: `epic:${fromAccountId}`,
        createdAt: nowIso,
        status: "pending",
      },
    };
  }

  if (msgType === "chat" || !msgType) {
    return {
      kind: "chat",
      fromAccountId,
      body: rawBody,
    };
  }

  return { kind: "unknown", fromAccountId, body: rawBody };
}
