import test from "node:test";
import assert from "node:assert/strict";
import {
  buildMacNativeObjectId,
  normalizeMacNativeTitle,
  parseAppstorrentDetailHtml,
  parseAppstorrentListingHtml,
  parseTorrentMacDetailHtml,
  parseTorrentMacListingHtml,
  splitTitleAndVersion,
} from "./mac-native-parsers.js";

test("splitTitleAndVersion extracts version suffix cleanly", () => {
  assert.deepEqual(splitTitleAndVersion("Crimson Desert 2.03.02"), {
    title: "Crimson Desert",
    version: "2.03.02",
  });
  assert.deepEqual(splitTitleAndVersion("Rebel Cops v1.0.7.0 (2019)"), {
    title: "Rebel Cops",
    version: "1.0.7.0",
  });
  assert.deepEqual(splitTitleAndVersion("Slay the Spire"), {
    title: "Slay the Spire",
    version: null,
  });
});

test("parseAppstorrentListingHtml parses games-item cards and Russian sizes", () => {
  const html = `
    <article class="games-item ">
      <div class="size"><div class="marker">8,7 ГБ</div></div>
      <div class="cover">
        <a href="/1545-slay-the-spire.html" class="link-title">
          <img src="/uploads/posts/min.jpg?rs=512x256" srcset="/uploads/posts/min.jpg?rs=512x256 512w, /uploads/posts/min.jpg?rs=1024x512 1024w" />
        </a>
      </div>
      <div class="icon">
        <img src="/uploads/posts/icon.png?rs=112x112" />
      </div>
      <div class="subtitle"><a href="/1545-slay-the-spire.html"><h2 class="body-2">Slay the Spire</h2></a></div>
    </article>
  `;
  const cards = parseAppstorrentListingHtml(html);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].title, "Slay the Spire");
  assert.equal(cards[0].fileSize, "8.7 GB");
  assert.equal(
    cards[0].coverUrl,
    "https://appstorrent.ru/uploads/posts/min.jpg?rs=1024x512"
  );
  assert.equal(
    cards[0].detailUrl,
    "https://appstorrent.ru/1545-slay-the-spire.html"
  );
});

test("parseAppstorrentDetailHtml extracts and orders direct CDN, MediaFire, Mail.ru links", () => {
  const html = `
    <button class="big green">Скачать бесплатно (388 МБ)</button>
    <div class="list_link">
      <p><a href="https://cloud.mail.ru/public/xmbn/zvuWNXqhs">Скачать с Mail.ru</a></p>
      <p><a href="https://www.mediafire.com/file/zyvxhtcwk8tutng/slay.pkg/file">Скачать с MediaFire</a></p>
      <p><a href="https://psv4.vkuserphoto.ru/s/v1/slay.pkg">Direct</a></p>
    </div>
  `;
  const parsed = parseAppstorrentDetailHtml(
    html,
    "https://appstorrent.ru/1545-slay-the-spire.html",
    "Slay the Spire"
  );
  assert.equal(parsed.fileSize, "388 MB");
  assert.equal(parsed.options.length, 3);
  assert.equal(parsed.options[0].hoster, "Direct CDN");
  assert.equal(parsed.options[1].hoster, "MediaFire");
  assert.equal(parsed.options[2].hoster, "Mail.ru Cloud");
});

test("parseTorrentMacListingHtml & parseTorrentMacDetailHtml parse articles and .torrent link", () => {
  const listingHtml = `
    <article id="post-128362" class="default-post post-128362 post category-games">
      <a href="https://www.torrentmac.net/crimson-desert-2-03-02/">
        <img class="wp-post-image" src="https://www.torrentmac.net/wp-content/uploads/cd-150x150.webp" srcset="https://www.torrentmac.net/wp-content/uploads/cd-150x150.webp 150w, https://www.torrentmac.net/wp-content/uploads/cd.webp 256w" />
      </a>
      <header>
        <h2 class="post-title"><a href="https://www.torrentmac.net/crimson-desert-2-03-02/">Crimson Desert 2.03.02</a></h2>
        <time datetime="2026-11-01">November 1, 2026</time>
      </header>
      <section class="post_content"><p>Open-world action RPG on Mac.</p></section>
    </article>
  `;
  const cards = parseTorrentMacListingHtml(listingHtml);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].title, "Crimson Desert");
  assert.equal(cards[0].version, "2.03.02");
  assert.equal(
    cards[0].coverUrl,
    "https://www.torrentmac.net/wp-content/uploads/cd.webp"
  );
  assert.equal(
    buildMacNativeObjectId(normalizeMacNativeTitle(cards[0].title)),
    "crimson-desert"
  );

  const detailHtml = `
    <article>
      <p>Size: 42.5 GB</p>
      <a href="https://www.torrentmac.net/wp-content/uploads/Crimson_Desert.torrent">Download Torrent</a>
    </article>
  `;
  const detail = parseTorrentMacDetailHtml(
    detailHtml,
    "https://www.torrentmac.net/crimson-desert-2-03-02/",
    "Crimson Desert"
  );
  assert.equal(detail.fileSize, "42.5 GB");
  assert.equal(detail.options.length, 1);
  assert.equal(detail.options[0].isTorrent, true);
  assert.equal(
    detail.options[0].url,
    "https://www.torrentmac.net/wp-content/uploads/Crimson_Desert.torrent"
  );
});
