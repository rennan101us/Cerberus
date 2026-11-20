import assert from "node:assert/strict";
import test from "node:test";
import {
  escapeXml,
  parseEpicMessageStanza,
  parseEpicPresenceStanza,
  unescapeXml,
} from "./epic-xmpp-parser.js";

test("escapeXml and unescapeXml roundtrip XML characters", () => {
  const sample = `A & B <tag attr="1" alt='2'>`;
  const escaped = escapeXml(sample);
  assert.ok(!escaped.includes("<tag"));
  assert.equal(unescapeXml(escaped), sample);
});

test("parseEpicPresenceStanza parses online JSON game presence and unavailable", () => {
  const onlineJson = JSON.stringify({
    Status: "Em partida - Battle Royale",
    ProductName: "Fortnite",
    bIsPlaying: true,
    bIsJoinable: true,
    Properties: {
      "party.joininfodata.286331153_j": {
        partyId: "party-xyz",
        appId: "Fortnite",
      },
    },
  });

  const presence = parseEpicPresenceStanza(
    `<presence from="acc123@prod.ol.epicgames.com/V2"><status>${escapeXml(onlineJson)}</status></presence>`
  );

  assert.equal(presence?.accountId, "acc123");
  assert.equal(presence?.isOnline, true);
  assert.equal(presence?.gameTitle, "Fortnite");
  assert.equal(presence?.appId, "Fortnite");
  assert.equal(presence?.partyId, "party-xyz");
  assert.equal(presence?.joinable, true);
  assert.equal(presence?.statusText, "Em partida - Battle Royale");

  const offline = parseEpicPresenceStanza(
    `<presence from="acc123@prod.ol.epicgames.com/V2" type="unavailable" />`
  );
  assert.equal(offline?.isOnline, false);
  assert.equal(offline?.gameTitle, null);
});

test("parseEpicMessageStanza parses text chat, JSON party invite, and fallback invite", () => {
  const chat = parseEpicMessageStanza(
    `<message from="friend1@prod.ol.epicgames.com/V2" type="chat"><body>${escapeXml("Bora jogar Rocket League?")}</body></message>`
  );
  assert.equal(chat?.kind, "chat");
  assert.equal(chat?.fromAccountId, "friend1");
  assert.equal(chat?.body, "Bora jogar Rocket League?");

  const partyPayload = JSON.stringify({
    type: "com.epicgames.social.party.notification.v0.PING",
    payload: {
      party_id: "p-99",
      appId: "Sugar",
      gameTitle: "Rocket League",
    },
  });
  const jsonInvite = parseEpicMessageStanza(
    `<message from="friend1@prod.ol.epicgames.com/V2" type="normal"><body>${escapeXml(partyPayload)}</body></message>`,
    "2026-11-20T12:00:00.000Z"
  );
  assert.equal(jsonInvite?.kind, "invite");
  assert.equal(jsonInvite?.invite?.partyId, "p-99");
  assert.equal(jsonInvite?.invite?.gameTitle, "Rocket League");
  assert.equal(jsonInvite?.invite?.inviterId, "epic:friend1");

  const textInvite = parseEpicMessageStanza(
    `<message from="friend2@prod.ol.epicgames.com/V2" type="chat"><body>${escapeXml("[Convite Epic: Fall Guys] (App: FallGuys)")}</body></message>`,
    "2026-11-20T12:05:00.000Z"
  );
  assert.equal(textInvite?.kind, "invite");
  assert.equal(textInvite?.invite?.appId, "FallGuys");
  assert.equal(textInvite?.invite?.gameTitle, "Fall Guys");
});
