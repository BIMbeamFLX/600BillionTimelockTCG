/* ---------------------------------------------------------------------------
 * 600B Timelock TCG — card faces from Blossom, cached locally.
 *
 * Content addressing makes the cache honest: the SHA-256 IS the identity, so
 * a hit can never be stale and nothing ever needs invalidating. Resolution
 * order: memory (this session) → Cache Storage (previous sessions) → the
 * mirrors in order → the repo file. file:// skips the network entirely, so
 * the offline hotseat keeps working with zero requests.
 *
 * ?assets=local forces repo files; ?assets=blossom forces the mirrors even
 * on localhost. Every resolved face reports its source, and setFace() pins a
 * small dot on the card: ember = fetched from a mirror just now, violet =
 * served from the local cache, none = local file.
 * ------------------------------------------------------------------------ */
(function (root) {
  "use strict";

  const BLOBS = root.E1_BLOBS || {};
  const MIRRORS = ["https://blossom.primal.net", "https://blossom.bimcvp.com", "https://nostr.download"];
  const LOCAL = "../art/cards/node-runner-web/";
  const CACHE_NAME = "600b-card-faces";

  const params = (() => {
    try {
      return new URLSearchParams(root.location.search);
    } catch (error) {
      return new URLSearchParams("");
    }
  })();
  const forced = params.get("assets");
  const offline = (() => {
    try {
      return root.location.protocol === "file:";
    } catch (error) {
      return true;
    }
  })();
  const mode = forced === "local" || (offline && forced !== "blossom") ? "local" : "blossom";
  const cacheApi = typeof caches !== "undefined" ? caches : null;

  const resolved = new Map(); // sha256 -> { url, source, server }
  const pending = new Map(); // sha256 -> Promise of the same

  async function fromMirrors(sha) {
    let cache = null;
    if (cacheApi) {
      try {
        cache = await cacheApi.open(CACHE_NAME);
        for (const server of MIRRORS) {
          const hit = await cache.match(`${server}/${sha}`);
          if (hit) return { blob: await hit.blob(), source: "cache", server };
        }
      } catch (error) {
        cache = null; // a broken Cache API is a slow day, not a broken game
      }
    }
    for (const server of MIRRORS) {
      try {
        const response = await fetch(`${server}/${sha}`);
        if (!response.ok) continue;
        if (cache) {
          try {
            await cache.put(`${server}/${sha}`, response.clone());
          } catch (error) {
            /* quota or opaque — serve it uncached */
          }
        }
        return { blob: await response.blob(), source: "blossom", server };
      } catch (error) {
        /* next mirror */
      }
    }
    return null;
  }

  /* face file name ("Zap.webp") -> { url, source, server? }. The object URL
   * is created once per blob and kept for the session — 297 faces bound it. */
  function resolve(face) {
    const sha = BLOBS[face];
    const local = { url: LOCAL + encodeURIComponent(face), source: "local" };
    if (mode === "local" || !sha) return Promise.resolve(local);
    if (resolved.has(sha)) return Promise.resolve(resolved.get(sha));
    if (!pending.has(sha)) {
      pending.set(
        sha,
        fromMirrors(sha).then((got) => {
          const entry = got
            ? { url: URL.createObjectURL(got.blob), source: got.source, server: got.server }
            : local;
          resolved.set(sha, entry);
          pending.delete(sha);
          return entry;
        })
      );
    }
    return pending.get(sha);
  }

  function title(entry) {
    if (entry.source === "blossom") return `Blossom · ${new URL(entry.server).host}`;
    if (entry.source === "cache") return `Blossom · local cache (${new URL(entry.server).host})`;
    return "local file";
  }

  /* Point an <img> at a face; when badgeHost is given, pin the source dot. */
  function setFace(img, face, badgeHost) {
    resolve(face).then((entry) => {
      img.src = entry.url;
      if (!badgeHost || !badgeHost.append || entry.source === "local") return;
      const dot = root.document.createElement("span");
      dot.className = `gsrc gsrc-${entry.source}`;
      dot.title = title(entry);
      badgeHost.append(dot);
    });
  }

  root.E1Faces = { resolve, setFace, mode, mirrors: MIRRORS, blobs: BLOBS };
})(typeof globalThis !== "undefined" ? globalThis : this);
