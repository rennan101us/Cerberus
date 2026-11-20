import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCerberusInviteUrl,
  parseCerberusInviteUrl,
} from "./cerberus-invite-link.js";

test("buildCerberusInviteUrl formats query parameters correctly", () => {
  const url = buildCerberusInviteUrl({
    shop: "steam",
    objectId: "1091500",
    title: "Cyberpunk 2077",
    lobbyId: "12345",
    connectString: "192.168.1.100:7777",
  });
  assert.ok(url.startsWith("cerberus://join?"));
  assert.ok(url.includes("shop=steam"));
  assert.ok(url.includes("id=1091500"));
  assert.ok(url.includes("lobby=12345"));
  assert.ok(url.includes("connect=192.168.1.100%3A7777"));
});

test("parseCerberusInviteUrl parses valid cerberus://join link", () => {
  const url =
    "cerberus://join?shop=switch1&id=0100000000010000&title=Super+Mario&connect=room123";
  const parsed = parseCerberusInviteUrl(url);
  assert.deepEqual(parsed, {
    shop: "switch1",
    objectId: "0100000000010000",
    title: "Super Mario",
    lobbyId: undefined,
    connectString: "room123",
  });
});

test("parseCerberusInviteUrl returns null for invalid url", () => {
  assert.equal(parseCerberusInviteUrl(null), null);
  assert.equal(parseCerberusInviteUrl("https://example.com"), null);
  assert.equal(parseCerberusInviteUrl("cerberus://join?shop=steam"), null);
});
