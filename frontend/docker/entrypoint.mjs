import { readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";

const DEFAULT_BACKEND_URL = "http://localhost:5001";

function resolveBackendUrl(rawUrl) {
  const candidate = rawUrl ?? DEFAULT_BACKEND_URL;
  let url;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error(
      "BACKEND_URL must be an absolute HTTP(S) URL without credentials, query, or fragment",
    );
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "BACKEND_URL must be an absolute HTTP(S) URL without credentials, query, or fragment",
    );
  }
  return `${url.origin}${url.pathname.replace(/\/+$/u, "")}`;
}

const backendUrl = resolveBackendUrl(process.env.BACKEND_URL);

const manifestPath = new URL("./.next/routes-manifest.json", import.meta.url);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
let patched = 0;
for (const group of [
  manifest.rewrites.beforeFiles,
  manifest.rewrites.afterFiles,
  manifest.rewrites.fallback,
]) {
  for (const rewrite of group ?? []) {
    if (/^https?:\/\//iu.test(rewrite.destination)) {
      rewrite.destination = rewrite.destination.replace(
        /^https?:\/\/[^/]+/iu,
        backendUrl,
      );
      patched += 1;
    }
  }
}
writeFileSync(manifestPath, JSON.stringify(manifest));
if (patched === 0) {
  throw new Error(
    "entrypoint: no absolute-URL rewrites found in routes-manifest.json; the BACKEND_URL rewrite contract changed",
  );
}
console.log(`entrypoint: pointed ${patched} rewrite(s) at ${backendUrl}`);

spawn("node", ["server.js"], { stdio: "inherit" }).on("exit", (code) => {
  process.exit(code ?? 1);
});
