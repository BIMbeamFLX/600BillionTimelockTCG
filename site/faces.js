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
  /* A shell (napplet host, deployment) may prepend its own mirror — e.g. the game's own
   * origin serving sha-named files — so the table works first-party even while the public
   * mirrors are missing blobs. Content addressing keeps this honest: whatever the mirror,
   * the bytes must still digest to the sha. */
  const MIRRORS = (Array.isArray(root.E1_MIRRORS) && root.E1_MIRRORS.length ? root.E1_MIRRORS : [])
    .concat(["https://blossom.primal.net", "https://blossom.bimcvp.com", "https://nostr.download"]);
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
  /* In a sandboxed document (napplet iframe) even READING `caches` throws a
   * SecurityError — and an uncaught throw here would take the whole module down
   * with it, which is exactly the failure the header forbids. No Cache API is a
   * slow day, not a broken game. */
  const cacheApi = (() => {
    try {
      return typeof caches !== "undefined" ? caches : null;
    } catch (error) {
      return null;
    }
  })();

  const resolved = new Map(); // sha256 -> { url, source, server }
  const pending = new Map(); // sha256 -> Promise of the same

  /* Only over a secure origin — crypto.subtle is undefined on plain http from a
   * non-localhost host. There the honest answer is that the bytes cannot be
   * checked, so the mirrors are skipped entirely and the repo file is used
   * rather than quietly accepting whatever a mirror returned. */
  const canDigest = () => Boolean(root.crypto && root.crypto.subtle && root.crypto.subtle.digest);

  async function digestMatches(bytes, sha) {
    try {
      const digest = await root.crypto.subtle.digest("SHA-256", bytes);
      const hex = Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      return hex === String(sha).toLowerCase();
    } catch (error) {
      return false;
    }
  }

  async function fromMirrors(sha) {
    if (!canDigest()) return null;
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
        const bytes = await response.arrayBuffer();
        /* CONTENT ADDRESSING YOU DO NOT CHECK IS JUST A URL WITH A LONG PATH.
         * The header above claims the SHA-256 IS the identity — that claim is
         * only true if somebody digests the bytes, and nobody was. A mirror
         * that served anything at all was believed and its answer persisted
         * into Cache Storage, where it would be trusted again next session. */
        if (!(await digestMatches(bytes, sha))) continue;
        const blob = new Blob([bytes], { type: response.headers.get("content-type") || "image/webp" });
        if (cache) {
          try {
            // Cached only AFTER the hash agrees, so the cache cannot be poisoned.
            await cache.put(`${server}/${sha}`, new Response(blob, { headers: response.headers }));
          } catch (error) {
            /* quota or opaque — serve it uncached */
          }
        }
        return { blob, source: "blossom", server };
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
          /* Only a HIT is cached. A mirror miss is transient (cold-start burst,
           * flaky network) — pinning the local fallback for the whole session
           * turns one bad moment into a permanently faceless game, and inside a
           * napplet the local path does not even exist. The next render simply
           * tries the mirrors again. */
          if (got) resolved.set(sha, entry);
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
