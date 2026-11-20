import type { SocialGameInvite } from "@types";
import { parseCerberusInviteUrl } from "@shared";

const STEAM_ID64_BASE = BigInt("76561197960265728");

/**
 * Accepts a 64-bit SteamID (7656119...) or Steam Friend Code (e.g. 123456789)
 * and converts it to a canonical SteamID64 string.
 */
export function resolveSteamIdentifier(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (/^7656119\d{10}$/.test(trimmed)) {
    return trimmed;
  }

  if (/^\d{1,10}$/.test(trimmed)) {
    const accountId = BigInt(trimmed);
    if (accountId > 0n && accountId < 4294967296n) {
      return (STEAM_ID64_BASE + accountId).toString();
    }
  }

  const profileMatch = /steamcommunity\.com\/profiles\/(7656119\d{10})/i.exec(
    trimmed
  );
  if (profileMatch) return profileMatch[1];

  return null;
}

export function getSteamFriendCode(steamId64: string): string {
  try {
    const num = BigInt(steamId64);
    if (num >= STEAM_ID64_BASE) {
      return (num - STEAM_ID64_BASE).toString();
    }
  } catch {
    // ignore
  }
  return steamId64;
}

const LOBBY_BBCODE_RE =
  /\[lobbyinvite\b[^\]]*appid=["']?(\d+)["']?[^\]]*lobbyid=["']?(\d+)["']?[^\]]*\](?:\[\/lobbyinvite\])?/i;
const JOIN_LOBBY_URL_RE = /steam:\/\/joinlobby\/(\d+)\/(\d+)(?:\/(\d+))?/i;
const CERBERUS_INVITE_RE =
  /^\[Convite de jogo:\s*(.+?)\]\s*(?:\(AppID:\s*(\d+)\))?/i;

export function parseSteamGameInviteFromMessage(params: {
  rawMessage: string;
  senderId: string;
  messageId: string;
  createdAt: string;
  fallbackGameTitle?: string;
  fallbackAppId?: string;
}): { body: string; invite?: SocialGameInvite } {
  const { rawMessage, senderId, messageId, createdAt } = params;

  const bbMatch = LOBBY_BBCODE_RE.exec(rawMessage);
  if (bbMatch) {
    const appId = bbMatch[1];
    const lobbyId = bbMatch[2];
    const cleaned = rawMessage.replace(bbMatch[0], "").trim();
    const title = params.fallbackGameTitle || `Jogo Steam (${appId})`;
    return {
      body: cleaned || `Convite para jogar ${title}`,
      invite: {
        id: messageId,
        provider: "steam",
        appId,
        gameTitle: title,
        lobbyId,
        inviterId: senderId,
        createdAt,
        status: "pending",
      },
    };
  }

  const urlMatch = JOIN_LOBBY_URL_RE.exec(rawMessage);
  if (urlMatch) {
    const appId = urlMatch[1];
    const lobbyId = urlMatch[2];
    const cleaned = rawMessage.replace(urlMatch[0], "").trim();
    const title = params.fallbackGameTitle || `Jogo Steam (${appId})`;
    return {
      body: cleaned || `Convite para jogar ${title}`,
      invite: {
        id: messageId,
        provider: "steam",
        appId,
        gameTitle: title,
        lobbyId,
        inviterId: senderId,
        createdAt,
        status: "pending",
      },
    };
  }

  const cerbMatch = CERBERUS_INVITE_RE.exec(rawMessage.trim());
  if (cerbMatch) {
    const title = cerbMatch[1].trim();
    const appId = cerbMatch[2] || params.fallbackAppId;
    return {
      body: rawMessage.trim(),
      invite: {
        id: messageId,
        provider: "steam",
        appId,
        gameTitle: title,
        inviterId: senderId,
        createdAt,
        status: "pending",
      },
    };
  }

  const cerbUrlMatch = /cerberus:\/\/join\S+/.exec(rawMessage);
  if (cerbUrlMatch) {
    const parsedCerb = parseCerberusInviteUrl(cerbUrlMatch[0]);
    if (parsedCerb) {
      return {
        body:
          rawMessage.replace(cerbUrlMatch[0], "").trim() ||
          `Convite para jogar ${parsedCerb.title}`,
        invite: {
          id: messageId,
          provider: "steam",
          appId: parsedCerb.objectId,
          gameTitle: parsedCerb.title,
          lobbyId: parsedCerb.lobbyId,
          connectString: parsedCerb.connectString,
          inviterId: senderId,
          createdAt,
          status: "pending",
        },
      };
    }
  }

  return { body: rawMessage };
}
