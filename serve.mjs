// Minimal static server. ES modules need an http origin, so opening index.html from the
// filesystem will not work.
//
//   node serve.mjs [port]
//
// The port can also come from the PORT environment. Module URLs carry the boot stamp:
// no-store alone does not clear the browser's module map, so an edited file can still run
// the previous version. Changing the URL itself is what works.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PORT = Number(process.argv[2]) || Number(process.env.PORT) || 7500;
const BUILD = Date.now().toString(36);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ico": "image/x-icon"
};

const stamp = (specifier) => (specifier.includes("?") ? specifier : `${specifier}?v=${BUILD}`);

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const path = url.pathname === "/" ? "/index.html" : url.pathname;
  const file = join(ROOT, normalize(path).replace(/^(\.\.[/\\])+/, ""));

  if (!file.startsWith(ROOT)) {
    response.writeHead(403).end("forbidden");
    return;
  }

  try {
    let body = await readFile(file);
    const type = TYPES[extname(file)] || "application/octet-stream";

    // Rewrite the entry points' own module URLs so a reload never runs a stale module.
    if (type.startsWith("text/html")) {
      body = Buffer.from(
        body
          .toString("utf8")
          .replace(/src="(\.\/src\/[^"]+)"/g, (_, specifier) => `src="${stamp(specifier)}"`)
          .replace(/href="(\.\/styles\.css)"/g, (_, specifier) => `href="${stamp(specifier)}"`)
      );
    }
    if (type.startsWith("text/javascript")) {
      // 판화는 src/plates/ 아래에서 "../rng.js"처럼 올라가며 부른다. ./만 보면 그 줄을 놓친다
      body = Buffer.from(body.toString("utf8").replace(/from "(\.\.?\/[^"]+)"/g, (_, specifier) => `from "${stamp(specifier)}"`));
    }

    response.writeHead(200, { "content-type": type, "cache-control": "no-store" }).end(body);
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("not found");
  }
});

// A port already taken is the ordinary way this fails: a server from an earlier session is
// usually still holding it. An unhandled 'error' event throws a stack trace that says none
// of that, so the one case worth naming gets named.
server.on("error", (error) => {
  if (error.code !== "EADDRINUSE") throw error;
  console.error(`port ${PORT} is already in use. Free it, or take another: node serve.mjs ${PORT + 1}`);
  process.exit(1);
});

server.listen(PORT, () => console.log(`llm-motion-graphic — http://localhost:${PORT}`));
