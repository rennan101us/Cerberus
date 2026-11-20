import assert from "node:assert/strict";
import test from "node:test";
import { parseDepotDownloaderLine } from "./depot-downloader-parser.js";

test("parseDepotDownloaderLine parses percentage progress lines", () => {
  const evt = parseDepotDownloaderLine("  42.50% Downloading depot 12345...");
  assert.equal(evt.progress, 0.425);
  assert.equal(evt.prompt, undefined);
});

test("parseDepotDownloaderLine parses Steam QR URLs and prompts steam-guard", () => {
  const evt = parseDepotDownloaderLine(
    "Scan QR code: https://s.team/q/1/9876543210abcdef."
  );
  assert.equal(evt.qrUrl, "https://s.team/q/1/9876543210abcdef");
  assert.equal(evt.prompt, "steam-guard");
});

test("parseDepotDownloaderLine detects 2FA, email auth code, and password prompts", () => {
  assert.equal(
    parseDepotDownloaderLine("Please enter your 2FA code from your mobile app:")
      .prompt,
    "steam-guard"
  );
  assert.equal(
    parseDepotDownloaderLine("Enter the auth code sent to your email:").prompt,
    "email-code"
  );
  assert.equal(
    parseDepotDownloaderLine("Enter account password:").prompt,
    "password"
  );
  assert.equal(
    parseDepotDownloaderLine("Enter account username:").prompt,
    "username"
  );
});

test("parseDepotDownloaderLine parses total downloaded bytes on completion", () => {
  const evt = parseDepotDownloaderLine("Total downloaded: 1,234,567 bytes");
  assert.equal(evt.totalBytes, 1234567);
  assert.equal(evt.progress, 1);
});
