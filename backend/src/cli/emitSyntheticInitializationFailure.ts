import { randomUUID } from "node:crypto";
import {
  createAssessmentInitializationObserver,
  getAssessmentInitializationObservabilityConfig,
  type AssessmentInitializationFailureEvent,
  type AssessmentInitializationObservabilityConfig,
  type AssessmentInitializationObserver,
} from "../service/assessmentInitializationObservability.service.js";

export interface EmitSyntheticInitializationFailureCliDependencies {
  loadConfig?: () => AssessmentInitializationObservabilityConfig;
  createObserver?: (config: AssessmentInitializationObservabilityConfig) => AssessmentInitializationObserver;
  requestId?: string;
  writeOutput?: (value: string) => void;
  writeError?: (value: string) => void;
}

function syntheticFailureEvent(requestId: string): AssessmentInitializationFailureEvent {
  return {
    eventName: "submission_initialization_failed",
    classification: "PREPARATION",
    internalReason: "PROMPT_MEDIA_SIGNING_FAILED",
    requestId,
    failureCount: 1,
    failedQuestionIds: [],
    failedCategories: ["PART_1"],
    preparationDurationMs: 12,
    categoryCount: 3,
  };
}

/**
 * Emits one sanitized, production-equivalent PROMPT_MEDIA_PREPARATION_FAILED
 * event through the observability seam so the telemetry destination, the
 * dashboard, and the warning alert path can be verified without rolling back
 * a real student initialization.
 */
export async function runSyntheticInitializationFailureCli(
  dependencies: EmitSyntheticInitializationFailureCliDependencies = {},
): Promise<number> {
  const writeOutput = dependencies.writeOutput ?? ((value: string) => console.log(value));
  const writeError = dependencies.writeError ?? ((value: string) => console.error(value));
  const loadConfig = dependencies.loadConfig ?? getAssessmentInitializationObservabilityConfig;

  let config: AssessmentInitializationObservabilityConfig;
  try {
    config = loadConfig();
  } catch (error) {
    writeError(
      error instanceof Error
        ? error.message
        : "The observability configuration is invalid",
    );
    return 1;
  }

  if (!config.lokiUrl) {
    writeError("OBSERVABILITY_LOKI_URL is not configured; there is no telemetry destination to verify.");
    return 1;
  }

  const observer =
    dependencies.createObserver?.(config) ??
    createAssessmentInitializationObserver({
      ...config,
      onDeliveryFailure: (error) => {
        writeError(
          `Telemetry delivery failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      },
    });

  const requestId = dependencies.requestId ?? `synthetic-${randomUUID()}`;
  observer.reportFailure(syntheticFailureEvent(requestId));

  try {
    await observer.flush();
  } catch (error) {
    writeError(
      `Telemetry delivery failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  }

  writeOutput(`Delivered a synthetic PROMPT_MEDIA_PREPARATION_FAILED event (requestId: ${requestId}).`);
  writeOutput("The dashboard should now show the failure and the warning alert path should fire.");
  return 0;
}
