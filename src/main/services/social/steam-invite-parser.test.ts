import assert from "node:assert/strict";
import test from "node:test";
import {
  getSteamFriendCode,
  parseSteamGameInviteFromMessage,
  resolveSteamIdentifier,
} from "./steam-invite-parser.js";

test("resolveSteamIdentifier converts SteamID64, Friend Code, and profile URLs", () => {
  const steamId64 = "76561198012345678";
  const friendCode = getSteamFriendCode(steamId64);

  assert.equal(resolveSteamIdentifier(steamId64), steamId64);
  assert.equal(resolveSteamIdentifier(friendCode), steamId64);
  assert.equal(
    resolveSteamIdentifier(`https://steamcommunity.com/profiles/${steamId64}/`),
    steamId64
  );
  assert.equal(resolveSteamIdentifier("not-a-steam-id"), null);
});

test("parseSteamGameInviteFromMessage parses [lobbyinvite] BBCode", () => {
  const parsed = parseSteamGameInviteFromMessage({
    rawMessage: "[lobbyinvite appid=570 lobbyid=109775244556677889][/lobbyinvite]",
    senderId: "steam:76561198000000001",
    messageId: "msg-1",
    createdAt: "2026-11-20T10:00:00.000Z",
    fallbackGameTitle: "Dota 2",
  });

  assert.equal(parsed.body, "Convite para jogar Dota 2");
  assert.deepEqual(parsed.invite, {
    id: "msg-1",
    provider: "steam",
    appId: "570",
    gameTitle: "Dota 2",
    lobbyId: "109775244556677889",
    inviterId: "steam:76561198000000001",
    createdAt: "2026-11-20T10:00:00.000Z",
    status: "pending",
  });
});

test("parseSteamGameInviteFromMessage parses steam://joinlobby and Cerberus fallback", () => {
  const lobbyUrl = parseSteamGameInviteFromMessage({
    rawMessage: "Bora jogar! steam://joinlobby/730/555666777/76561198000000001",
    senderId: "steam:76561198000000001",
    messageId: "msg-2",
    createdAt: "2026-11-20T10:05:00.000Z",
  });

  assert.equal(lobbyUrl.body, "Bora jogar!");
  assert.equal(lobbyUrl.invite?.appId, "730");
  assert.equal(lobbyUrl.invite?.lobbyId, "555666777");

  const fallback = parseSteamGameInviteFromMessage({
    rawMessage: "[Convite de jogo: Hades II] (AppID: 1145350)",
    senderId: "steam:76561198000000001",
    messageId: "msg-3",
    createdAt: "2026-11-20T10:10:00.000Z",
  });

  assert.equal(fallback.invite?.gameTitle, "Hades II");
  assert.equal(fallback.invite?.appId, "1145350");

  const plain = parseSteamGameInviteFromMessage({
    rawMessage: "Oi, tudo bem?",
    senderId: "steam:76561198000000001",
    messageId: "msg-4",
    createdAt: "2026-11-20T10:15:00.000Z",
  });
  assert.equal(plain.body, "Oi, tudo bem?");
  assert.equal(plain.invite, undefined);
});
