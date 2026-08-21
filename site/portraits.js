/* ---------------------------------------------------------------------------
 * 600B Timelock TCG — one character portrait, one answer, every surface.
 *
 * A player is a character, not a card. The site ships one square portrait per
 * character in art/site/portraits/, and this file is the only place that turns
 * a name into one of them. The table, the announcements and the seat picker all
 * ask here rather than each deriving their own answer, because three copies of
 * this rule is exactly how three surfaces end up showing three different faces.
 *
 * The rule survives without the index. The index is a fetch and a page opened
 * from file:// cannot make one, so the slug is derived from the name and the
 * file name is assumed; the index only corrects that — it names each file
 * exactly and it says which characters exist, which is the difference between
 * a portrait and a 404. Callers must still cope with a portrait that does not
 * load: this module answers with a URL, never with a promise that it renders.
 * ------------------------------------------------------------------------ */
(function (root) {
  "use strict";

  /* Pages sit at the origin root with art/ mounted beside them, so `..` clamps
   * onto exactly what the referee serves and what publish_site.py copies. The
   * index is named portraits.json rather than manifest.json because
   * publish_site.py drops every file called manifest.json from the publish set,
   * wherever it appears. */
  const DIR = "../art/site/portraits/";
  const INDEX = DIR + "portraits.json";

  /* Must match slugify() in scripts/build_portraits.py, which is what named the
   * files: every run of non-alphanumerics becomes one hyphen. "Toni China" is
   * toni-china, not tonichina — collapsing the space away instead of keeping it
   * as a hyphen silently loses all four of her cards. */
  const slugify = (text) => String(text == null ? "" : text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  /* The names 600.wtf publishes an identity under, where they differ from the
   * portrait's own. Every card for the character "P" is titled "Proton, …", and
   * "GDJ" is Gadaj's other handle. The index carries the same pairs in
   * card_aliases and overwrites these the moment it lands; they are hard-coded
   * so that three of Proton's cards still have a face on a file:// page that
   * can never read the index. */
  const aliases = new Map([["proton", "p"], ["gdj", "gadaj"]]);
  const files = new Map();   // slug -> file name, from the index
  const names = new Map();   // slug -> the name printed under the portrait
  /* The slugs the index vouches for, or null while it has not been read. Null
   * means "answer optimistically": a derived name is right for all 33 portraits
   * that ship today, and a caller that hits a 404 falls back. */
  let known = null;

  /* A card is "<character>, <epithet>" and a duo card is "Rootzoll & Leon" —
   * what stands before the first comma and before the ampersand is the
   * character whose face it wears. A seat name has neither and comes through
   * whole, which is what lets "FLX" at a networked seat land on the same face
   * the FLX cards do, on both clients, with nothing sent over the wire. */
  function slugFor(text) {
    const head = String(text == null ? "" : text).split(",")[0].split("&")[0];
    const slug = slugify(head);
    if (!slug) return null;
    return aliases.get(slug) || slug;
  }

  function urlFor(text) {
    const slug = slugFor(text);
    if (!slug) return null;
    if (known && !known.has(slug)) return null;   // the index knows nobody by that name
    /* encodeURIComponent, not a bare join: the file name comes out of a JSON
     * document, and a slash or a `..` inside one must stay a file name rather
     * than becoming a path. */
    return DIR + encodeURIComponent(files.get(slug) || slug + ".webp");
  }

  function adopt(index) {
    const list = index && Array.isArray(index.portraits) ? index.portraits : null;
    if (!list || !list.length) return false;
    const entries = list.filter((entry) => entry
      && typeof entry.slug === "string" && entry.slug
      && typeof entry.file === "string" && entry.file);
    if (!entries.length) return false;
    const slugs = new Set();
    for (const entry of entries) {
      slugs.add(entry.slug);
      files.set(entry.slug, entry.file);
      /* The name as it is printed under the portrait. The picker needs it and
         cannot derive it: "saltmonster" is not "Salt Monster", and title-casing
         a slug is a guess that reads as a typo to the person it names. */
      if (typeof entry.name === "string" && entry.name.trim()) names.set(entry.slug, entry.name.trim());
    }
    /* A portrait's own slug always means that portrait, so no alias may point
     * away from it — not even one of the two hard-coded above, if the roster
     * ever grows a character actually called Proton. */
    for (const slug of slugs) aliases.delete(slug);
    /* card_aliases is what a CARD calls this character, which is not always the
     * name printed under the portrait. Reading it from the index instead of a
     * table in here is what keeps the two in step as the roster grows.
     *
     * Aliases are applied only once every slug is known, and the first claim
     * wins. The index carries two rosters and the second is somebody else's
     * live file: a member there whose display name matches a character on a
     * card would otherwise overwrite that name, and every one of that
     * character's cards would quietly wear a stranger's face. */
    const claimed = new Set();
    for (const entry of entries) {
      const names = Array.isArray(entry.card_aliases) ? entry.card_aliases.slice() : [];
      if (typeof entry.name === "string") names.push(entry.name);
      for (const alias of names) {
        const slug = slugify(alias);
        if (!slug || slug === entry.slug || slugs.has(slug) || claimed.has(slug)) continue;
        aliases.set(slug, entry.slug);
        claimed.add(slug);
      }
    }
    known = slugs;
    return true;
  }

  /* One attempt, at load, and never again: the index is a build output that
   * cannot change while the page is open. Failure is not an error — file://
   * cannot fetch, a sandboxed shell may reach nothing at all, and the derived
   * name above is already right. */
  const ready = (function () {
    if (typeof root.fetch !== "function") return Promise.resolve(false);
    try {
      return root.fetch(INDEX)
        .then((response) => (response && response.ok ? response.json() : null))
        .then((index) => adopt(index))
        .catch(() => false);
    } catch (error) {
      return Promise.resolve(false);
    }
  })();

  root.E1Portraits = {
    /* Exported so the property can be tested rather than assumed: every one of
     * the 92 Avatar cards must find a character, and a rule that maps 91 is a
     * player with no face. */
    slugFor,
    urlFor,
    ready,
    /* True once the index has been adopted. Before that urlFor still answers,
     * optimistically — it just cannot yet say that a character is unknown. */
    verified: () => known !== null,
    characters: () => (known ? Array.from(known).sort() : []),
    /* The display name for a slug, or "" when the index has not been read or
       never carried one. Returning "" rather than the slug keeps the caller's
       fallback its own decision instead of handing it something that looks
       like a name and is not. */
    nameFor: (slug) => names.get(String(slug || "")) || "",
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
