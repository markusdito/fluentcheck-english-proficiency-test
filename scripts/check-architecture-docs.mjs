import { execFileSync } from "node:child_process";
import {
  existsSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import { join, relative } from "node:path";

const repoRoot = process.cwd();
const failures = [];

function readRepoFile(file) {
  const absolutePath = join(repoRoot, file);
  if (!existsSync(absolutePath)) {
    failures.push("Missing repository file: " + file);
    return "";
  }
  return readFileSync(absolutePath, "utf8");
}

function normalizePath(prefix, route) {
  const joined = prefix + "/" + (route === "/" ? "" : route);
  const normalized = joined.replace(/\/+/g, "/").replace(/\/$/, "");
  return normalized || "/";
}

function collectRoutes(file, prefix, kind) {
  const contents = readRepoFile(file);
  const expression =
    kind === "app"
      ? /\bapp\.(get|post|put|patch|delete)\s*\(\s*(["'])([^"']+)\2/g
      : /\brouter\.(get|post|put|patch|delete)\s*\(\s*(["'])([^"']+)\2/g;
  const routes = [];
  let match;

  while ((match = expression.exec(contents)) !== null) {
    routes.push({
      method: match[1].toUpperCase(),
      path: normalizePath(prefix, match[3]),
      source: file,
    });
  }

  return routes;
}

const backendRouteSources = [
  { file: "backend/src/server.ts", prefix: "", kind: "app" },
  { file: "backend/src/routes/auth.routes.ts", prefix: "/api/auth", kind: "router" },
  {
    file: "backend/src/routes/google-auth.routes.ts",
    prefix: "/api/auth/google",
    kind: "router",
  },
  {
    file: "backend/src/routes/question.routes.ts",
    prefix: "/api/questions",
    kind: "router",
  },
  { file: "backend/src/routes/upload.routes.ts", prefix: "/api/uploads", kind: "router" },
  {
    file: "backend/src/routes/submission.routes.ts",
    prefix: "/api/submissions",
    kind: "router",
  },
  {
    file: "backend/src/routes/payment.routes.ts",
    prefix: "/api/payments",
    kind: "router",
  },
  {
    file: "backend/src/routes/examiner.routes.ts",
    prefix: "/api/examiner",
    kind: "router",
  },
  { file: "backend/src/routes/admin.routes.ts", prefix: "/api/admin", kind: "router" },
];

function routeKey(route) {
  return route.method + " " + route.path;
}

function extractRouteMarkers(contents) {
  const expression =
    /<!--\s*route:\s*(GET|POST|PUT|PATCH|DELETE)\s+(\S+)\s*\|\s*source=([^>]+?)\s*-->/g;
  const markers = [];
  let match;

  while ((match = expression.exec(contents)) !== null) {
    markers.push({
      method: match[1],
      path: match[2],
      source: match[3].trim().split("#")[0],
    });
  }

  return markers;
}

function checkRouteInventory() {
  const actualRoutes = backendRouteSources.flatMap((source) =>
    collectRoutes(source.file, source.prefix, source.kind),
  );
  const actualByKey = new Map();

  for (const route of actualRoutes) {
    const key = routeKey(route);
    if (actualByKey.has(key)) {
      failures.push("Duplicate route declaration: " + key);
    }
    actualByKey.set(key, route);
  }

  const documentation = readRepoFile("backend/docs/BACKEND_ARCHITECTURE.md");
  const documentedByKey = new Map();

  for (const marker of extractRouteMarkers(documentation)) {
    const key = routeKey(marker);
    if (documentedByKey.has(key)) {
      failures.push("Duplicate backend route marker: " + key);
      continue;
    }

    const actual = actualByKey.get(key);
    if (!actual) {
      failures.push("Stale backend route marker: " + key);
      continue;
    }

    if (marker.source !== actual.source) {
      failures.push(
        "Wrong source for " +
          key +
          ": documented " +
          marker.source +
          ", actual " +
          actual.source,
      );
    }
    documentedByKey.set(key, marker);
  }

  for (const actual of actualRoutes) {
    const key = routeKey(actual);
    if (!documentedByKey.has(key)) {
      failures.push("Undocumented backend route: " + key);
    }
  }
}

function walkFiles(directory) {
  if (!existsSync(directory)) return [];
  const files = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(absolutePath));
    } else {
      files.push(absolutePath);
    }
  }

  return files;
}

function pagePath(file) {
  const appDirectory = join(repoRoot, "frontend/app");
  const relativeFile = relative(appDirectory, file).replaceAll("\\", "/");
  const directory =
    relativeFile === "page.tsx"
      ? ""
      : relativeFile.replace(/\/page\.tsx$/, "");
  const segments = directory
    .split("/")
    .filter(Boolean)
    .filter((segment) => !segment.startsWith("(") && !segment.startsWith("@"));
  return segments.length === 0 ? "/" : "/" + segments.join("/");
}

function extractPageMarkers(contents) {
  const expression =
    /<!--\s*page:\s*(\S+)\s*\|\s*source=([^>]+?)\s*-->/g;
  const markers = [];
  let match;

  while ((match = expression.exec(contents)) !== null) {
    markers.push({
      path: match[1],
      source: match[2].trim(),
    });
  }

  return markers;
}

function checkPageInventory() {
  const actualPages = walkFiles(join(repoRoot, "frontend/app"))
    .filter((file) => file.endsWith("/page.tsx"))
    .map((file) => ({
      path: pagePath(file),
      source: relative(repoRoot, file).replaceAll("\\", "/"),
    }));
  const actualByPath = new Map();

  for (const page of actualPages) {
    if (actualByPath.has(page.path)) {
      failures.push("Duplicate page declaration: " + page.path);
    }
    actualByPath.set(page.path, page);
  }

  const documentation = readRepoFile("frontend/docs/FRONTEND_ARCHITECTURE.md");
  const documentedByPath = new Map();

  for (const marker of extractPageMarkers(documentation)) {
    if (documentedByPath.has(marker.path)) {
      failures.push("Duplicate frontend page marker: " + marker.path);
      continue;
    }

    const actual = actualByPath.get(marker.path);
    if (!actual) {
      failures.push("Stale frontend page marker: " + marker.path);
      continue;
    }

    if (marker.source !== actual.source) {
      failures.push(
        "Wrong source for page " +
          marker.path +
          ": documented " +
          marker.source +
          ", actual " +
          actual.source,
      );
    }
    documentedByPath.set(marker.path, marker);
  }

  for (const actual of actualPages) {
    if (!documentedByPath.has(actual.path)) {
      failures.push("Undocumented frontend page: " + actual.path);
    }
  }
}

function changedFilesSinceBase() {
  const base = process.env.DOCS_BASE_SHA;
  if (!base || /^0+$/.test(base)) return null;

  try {
    const output = execFileSync("git", ["diff", "--name-only", base + "...HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    return output.split("\n").map((file) => file.trim()).filter(Boolean);
  } catch (error) {
    failures.push(
      "Could not inspect changed files from DOCS_BASE_SHA: " +
        (error instanceof Error ? error.message : String(error)),
    );
    return [];
  }
}

function checkDocumentationChangeGate() {
  const changedFiles = changedFilesSinceBase();
  if (changedFiles === null) {
    console.log("Documentation change gate skipped: DOCS_BASE_SHA is not set.");
    return;
  }

  const backendChanged = changedFiles.some(
    (file) =>
      /^backend\/src\/(routes|controllers|service|middleware|utils|config)\//.test(file) ||
      file === "backend/src/server.ts" ||
      file === "backend/prisma/schema.prisma" ||
      file.startsWith("backend/prisma/migrations/"),
  );
  const frontendChanged = changedFiles.some(
    (file) =>
      /^frontend\/(components|hooks|lib)\//.test(file) ||
      (/^frontend\/app\//.test(file) &&
        !file.startsWith("frontend/app/_assets/") &&
        /\.(ts|tsx)$/.test(file)),
  );

  if (backendChanged && !changedFiles.includes("backend/docs/BACKEND_ARCHITECTURE.md")) {
    failures.push(
      "Backend route/domain changes require backend/docs/BACKEND_ARCHITECTURE.md to be reviewed.",
    );
  }
  if (frontendChanged && !changedFiles.includes("frontend/docs/FRONTEND_ARCHITECTURE.md")) {
    failures.push(
      "Frontend route/feature changes require frontend/docs/FRONTEND_ARCHITECTURE.md to be reviewed.",
    );
  }
}

checkRouteInventory();
checkPageInventory();
if (process.argv.includes("--check-changes")) {
  checkDocumentationChangeGate();
}

if (failures.length > 0) {
  console.error("Architecture documentation check failed:");
  for (const failure of failures) console.error("- " + failure);
  process.exitCode = 1;
} else {
  console.log("Architecture documentation inventory check passed.");
}
