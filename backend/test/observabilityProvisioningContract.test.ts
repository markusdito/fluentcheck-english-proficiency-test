import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parse } from "yaml";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const SERVICE_NAME = "fluentcheck-backend";
const PRODUCTION_ENVIRONMENT = "production";
const FAILURE_SELECTOR =
  `{service="${SERVICE_NAME}", environment="${PRODUCTION_ENVIRONMENT}", source="submission_initialization_failed"}`;
const PROMPT_MEDIA_SELECTOR =
  `{service="${SERVICE_NAME}", environment="${PRODUCTION_ENVIRONMENT}", event="PROMPT_MEDIA_PREPARATION_FAILED"}`;

async function readRepositoryFile(...segments: string[]): Promise<string> {
  return readFile(join(repoRoot, ...segments), "utf8");
}

interface AlertRule {
  title: string;
  for: string;
  annotations: Record<string, string>;
  labels: Record<string, string>;
  data: Array<{ model: { expr?: string } }>;
}

function serializeAlertRule(rule: AlertRule): string {
  return JSON.stringify(rule);
}

function dataQueryExpressions(rule: AlertRule): string {
  return rule.data.map((query) => query.model.expr ?? "").join("\n");
}

async function loadAlertRules(): Promise<AlertRule[]> {
  const provisioning = parse(
    await readRepositoryFile("ops", "grafana", "provisioning", "alerting", "assessment-initialization.yml"),
  ) as { apiVersion: number; groups: Array<{ rules: AlertRule[] }> };
  assert.equal(provisioning.apiVersion, 1);
  return provisioning.groups.flatMap((group) => group.rules);
}

test("provisions the Loki datasource with a stable uid", async () => {
  const provisioning = parse(
    await readRepositoryFile("ops", "grafana", "provisioning", "datasources", "loki.yml"),
  ) as {
    apiVersion: number;
    datasources: Array<{ name: string; uid: string; type: string; access: string }>;
  };

  assert.equal(provisioning.apiVersion, 1);
  const loki = provisioning.datasources.find((datasource) => datasource.type === "loki");
  assert.ok(loki, "a Loki datasource must be provisioned");
  assert.equal(loki.uid, "assessment-initialization-loki");
  assert.equal(loki.access, "proxy");
});

test("provisions an assessment-initialization dashboard covering attempts, failures, failure rate, and failure reason", async () => {
  const raw = await readRepositoryFile("ops", "grafana", "dashboards", "assessment-initialization.json");
  const dashboard = JSON.parse(raw) as {
    title: string;
    panels: Array<{ type: string; title: string; targets?: Array<{ expr?: string }> }>;
  };

  assert.equal(dashboard.title, "Assessment initialization");
  const expressions = dashboard.panels.flatMap((panel) =>
    (panel.targets ?? []).map((target) => target.expr ?? ""),
  );
  const joined = expressions.join("\n");

  assert.ok(
    expressions.some((expr) =>
      expr.includes('event="SUBMISSION_INITIALIZATION_ATTEMPTED"') && expr.includes('environment="$environment"'),
    ),
    "dashboard must chart initialization attempts",
  );
  assert.ok(
    expressions.some((expr) => expr.includes('{service="fluentcheck-backend", environment="$environment", source="submission_initialization_failed"}')),
    "dashboard must chart initialization failures",
  );
  assert.ok(
    expressions.some((expr) => expr.includes("SUBMISSION_INITIALIZATION_ATTEMPTED") && expr.includes("submission_initialization_failed")) &&
      dashboard.panels.some((panel) => /rate/i.test(panel.title)),
    "dashboard must chart the failure rate",
  );
  assert.ok(
    expressions.some((expr) => expr.includes("internalReason")),
    "dashboard must break failures down by failure reason",
  );

  const excluded = ["studentId", "idempotencyKey", "storageKey", "signedUrl", "https://", "credentials"];
  for (const field of excluded) {
    assert.equal(joined.includes(field), false, `dashboard queries must not expose ${field}`);
  }
});

test("provisions a warning alert for every production Prompt media preparation failure", async () => {
  const rules = await loadAlertRules();
  const warning = rules.find((rule) => rule.title === "PromptMediaPreparationFailed");
  assert.ok(warning, "a Prompt-media preparation warning rule must exist");

  const expressions = dataQueryExpressions(warning);
  assert.ok(
    expressions.includes(PROMPT_MEDIA_SELECTOR),
    "warning rule must fire on production PROMPT_MEDIA_PREPARATION_FAILED events only",
  );
  assert.ok(
    expressions.includes("count_over_time"),
    "warning rule must count failure log lines",
  );
  assert.ok(
    serializeAlertRule(warning).includes('"type":"gte"') && serializeAlertRule(warning).includes('"params":[1]'),
    "a single production failure must trigger the warning path",
  );
  assert.equal(warning.for, "0m", "the warning must not be delayed");
  assert.equal(warning.labels.severity, "warning");
  assert.equal(warning.labels.service, SERVICE_NAME);
  assert.equal(warning.labels.environment, PRODUCTION_ENVIRONMENT);
  assert.match(warning.annotations.runbook_url!, /docs\/runbooks\/assessment-initialization-failures\.md$/u);
  assert.ok(warning.annotations.summary!.includes(SERVICE_NAME));
  assert.ok(warning.annotations.summary!.includes(PRODUCTION_ENVIRONMENT));
});

test("provisions a paging alert when at least three preparation failures occur within five minutes", async () => {
  const rules = await loadAlertRules();
  const page = rules.find((rule) => rule.title === "PromptMediaPreparationFailureBurst");
  assert.ok(page, "a paging rule must exist");

  const expressions = dataQueryExpressions(page);
  assert.ok(
    expressions.includes(PROMPT_MEDIA_SELECTOR),
    "paging rule must count production Prompt media preparation failures",
  );
  assert.match(expressions, /\[5m\]/u, "paging rule must use a five-minute window");
  assert.ok(
    serializeAlertRule(page).includes('"params":[3]'),
    "paging rule must fire at the third failure",
  );
  assert.equal(page.labels.severity, "critical");
  assert.equal(page.labels.service, SERVICE_NAME);
  assert.equal(page.labels.environment, PRODUCTION_ENVIRONMENT);
  assert.match(page.annotations.runbook_url!, /docs\/runbooks\/assessment-initialization-failures\.md$/u);
  assert.ok(page.annotations.summary!.includes(SERVICE_NAME));
  assert.ok(page.annotations.summary!.includes(PRODUCTION_ENVIRONMENT));
});

test("provisions a dashboard provider so self-hosted Grafana loads the dashboard", async () => {
  const provisioning = parse(
    await readRepositoryFile("ops", "grafana", "provisioning", "dashboards", "provider.yml"),
  ) as {
    apiVersion: number;
    providers: Array<{ name: string; options: { path: string } }>;
  };

  assert.equal(provisioning.apiVersion, 1);
  assert.ok(
    provisioning.providers.some((provider) => provider.options.path.endsWith("dashboards")),
    "a provider must point at the dashboards folder",
  );
});
