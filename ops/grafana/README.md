# Grafana provisioning for assessment-initialization observability

The backend pushes sanitized assessment-initialization events to Grafana
Cloud Loki (see `docs/adr/0017-grafana-cloud-loki-for-assessment-initialization-telemetry.md`).
This directory is the monitoring surface on top of that stream:

- `provisioning/datasources/loki.yml` — the Loki datasource (uid
  `assessment-initialization-loki`).
- `provisioning/dashboards/provider.yml` + `dashboards/assessment-initialization.json`
  — the **Assessment initialization** dashboard: attempts, failures, failure
  rate, and failure reason.
- `provisioning/alerting/assessment-initialization.yml` — two Grafana-managed
  alert rules:
  - `PromptMediaPreparationFailed` (warning): every production
    `PROMPT_MEDIA_PREPARATION_FAILED` event.
  - `PromptMediaPreparationFailureBurst` (critical): three or more
    preparation failures within five minutes.

Both rules link to
`docs/runbooks/assessment-initialization-failures.md`, which is the runbook
referenced by `OBSERVABILITY_RUNBOOK_URL`. If the runbook moves, update both
the alert `runbook_url` annotations and `OBSERVABILITY_RUNBOOK_URL` together:
the environment variable is the production startup gate, while the
annotations are what the delivered alerts link to.

## Self-hosted Grafana

Mount the provisioning tree and dashboards into the container:

```
/etc/grafana/provisioning/datasources/loki.yml
/etc/grafana/provisioning/dashboards/provider.yml
/var/lib/grafana/dashboards/assessment-initialization.json
```

The dashboard provider points at `/var/lib/grafana/dashboards` and creates
the `FluentCheck` folder. Restart Grafana; provisioning applies on boot.

## Grafana Cloud

1. Import `dashboards/assessment-initialization.json` and select the stack's
   Loki datasource.
2. Recreate the two alert rules from
   `provisioning/alerting/assessment-initialization.yml` in the Grafana
   alerting UI (or apply them with the `grafana` Terraform provider). The
   queries are LogQL and already scoped to
   `service="fluentcheck-backend", environment="production"`.
3. Configure the contact points and notification policy for your paging
   destination: route `severity=critical` to the paging integration
   (PagerDuty/Opsgenie) and `severity=warning` to the chat channel. Contact
   points are deployment-specific and intentionally not provisioned here —
   until this step is done, the critical rule fires but pages nobody.

## Verify

Run `npm run observability:synthetic-failure` (backend) against the
configured environment: one synthetic `PROMPT_MEDIA_PREPARATION_FAILED`
event should appear on the dashboard and fire the warning rule. See the
runbook for the full verification and escalation procedure.

`backend/test/observabilityProvisioningContract.test.ts` validates these
files against the seam's wire contract; run the backend unit tests after
editing anything here.
