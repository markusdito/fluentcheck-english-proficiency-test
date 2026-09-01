import { randomUUID } from "node:crypto";
import { env } from "../config/env.js";
import { prisma } from "../config/db.js";
import { deleteStorageObject, } from "./retentionStorage.service.js";
export const RETENTION_POLICY_VERSION = "2026-08-31";
export const RETENTION_QUARANTINE_DAYS = 30;
export const RETENTION_QUARANTINE_MS = RETENTION_QUARANTINE_DAYS * 24 * 60 * 60 * 1000;
const PURGEABLE_STATUSES = [
    "IN_PROGRESS",
    "ABANDONED",
    "AWAITING_PAYMENT",
];
export class RetentionOperationError extends Error {
    code;
    details;
    constructor(code, message, details) {
        super(message);
        this.code = code;
        this.details = details;
        this.name = "RetentionOperationError";
    }
}
export class SubmissionPurgeNotEligibleError extends RetentionOperationError {
    blockers;
    constructor(blockers) {
        super("PURGE_NOT_ELIGIBLE", "Submission is not eligible for purge", { blockers });
        this.blockers = blockers;
        this.name = "SubmissionPurgeNotEligibleError";
    }
}
export class RetentionCleanupDisabledError extends RetentionOperationError {
    constructor() {
        super("RETENTION_CLEANUP_DISABLED", "Retention cleanup is disabled; set RETENTION_CLEANUP_ENABLED=1 for an authorized run");
        this.name = "RetentionCleanupDisabledError";
    }
}
function databaseOf(dependencies) {
    return dependencies.database ?? prisma;
}
function nowOf(dependencies) {
    return dependencies.now?.() ?? new Date();
}
function storageOf(dependencies) {
    return dependencies.storage ?? { deleteObject: deleteStorageObject };
}
function requireReason(reason) {
    const normalized = reason.trim();
    if (!normalized) {
        throw new RetentionOperationError("REASON_REQUIRED", "A non-empty retention reason is required");
    }
    if (normalized.length > 2_000) {
        throw new RetentionOperationError("REASON_TOO_LONG", "Retention reason must be 2,000 characters or fewer");
    }
    return normalized;
}
function requireAuthorizationId(value, fallback) {
    const normalized = value?.trim() || fallback;
    if (!normalized) {
        throw new RetentionOperationError("AUTHORIZATION_REQUIRED", "Explicit authorization evidence is required");
    }
    return normalized;
}
function assertCleanupEnabled(dependencies) {
    if (!(dependencies.enabled ?? env.RETENTION_CLEANUP_ENABLED)) {
        throw new RetentionCleanupDisabledError();
    }
}
async function assertActiveAdmin(transaction, actorId) {
    const actor = await transaction.user.findFirst({
        where: { id: actorId, role: "ADMIN", deletedAt: null },
        select: { id: true },
    });
    if (!actor) {
        throw new RetentionOperationError("ACTIVE_ADMIN_REQUIRED", "An active ADMIN account is required");
    }
}
async function audit(transaction, input) {
    await transaction.retentionAuditEvent.create({
        data: {
            id: randomUUID(),
            targetSubmissionId: input.targetSubmissionId,
            submissionId: input.submissionId,
            purgeRequestId: input.purgeRequestId,
            cleanupRunId: input.cleanupRunId,
            actorId: input.actorId,
            action: input.action,
            authorizationId: input.authorizationId,
            policyVersion: RETENTION_POLICY_VERSION,
            reason: input.reason,
            storageKey: input.storageKey,
            outcome: input.outcome,
            metadata: input.metadata === undefined
                ? undefined
                : input.metadata,
        },
    });
}
async function loadSubmissionPolicy(transaction, submissionId) {
    return transaction.submission.findUnique({
        where: { id: submissionId },
        select: {
            id: true,
            status: true,
            retentionStatus: true,
            payments: { select: { status: true } },
            assignments: { select: { id: true } },
            certificate: { select: { id: true } },
            retentionHolds: {
                where: { releasedAt: null },
                select: { id: true, type: true, reason: true },
            },
        },
    });
}
function purgeBlockers(snapshot) {
    const blockers = [];
    if (snapshot.retentionStatus !== "RETAINED") {
        blockers.push(`Retention status is ${snapshot.retentionStatus}`);
    }
    if (!PURGEABLE_STATUSES.includes(snapshot.status)) {
        blockers.push(`Submission status ${snapshot.status} is retained by policy`);
    }
    const blockingPayments = snapshot.payments.filter((payment) => payment.status !== "FAILED" && payment.status !== "REFUNDED");
    if (blockingPayments.length > 0) {
        blockers.push("A payment obligation or payment history is still active");
    }
    if (snapshot.assignments.length > 0) {
        blockers.push("Examiner assignments exist");
    }
    if (snapshot.certificate) {
        blockers.push("A certificate exists");
    }
    for (const hold of snapshot.retentionHolds) {
        blockers.push(`Active ${hold.type} Retention hold: ${hold.reason}`);
    }
    return blockers;
}
function activeHoldBlockers(snapshot) {
    return snapshot.retentionHolds.map((hold) => `Active ${hold.type} Retention hold: ${hold.reason}`);
}
function requestAuthorizationId(requestId) {
    return `purge-request:${requestId}`;
}
function approvalAuthorizationId(requestId) {
    return `purge-approval:${requestId}`;
}
function resultAuthorizationId(requestId) {
    return `purge-finalization:${requestId}`;
}
/** Request a purge without changing the Submission or touching storage. */
export async function requestSubmissionPurge(submissionId, requesterId, options, dependencies = {}) {
    const reason = requireReason(options.reason);
    const database = databaseOf(dependencies);
    return database.$transaction(async (transaction) => {
        await assertActiveAdmin(transaction, requesterId);
        await transaction.$queryRaw `
      SELECT "id" FROM "Submission" WHERE "id" = ${submissionId}::uuid FOR UPDATE
    `;
        const submission = await loadSubmissionPolicy(transaction, submissionId);
        if (!submission) {
            throw new RetentionOperationError("SUBMISSION_NOT_FOUND", "Submission not found");
        }
        const existing = await transaction.submissionPurgeRequest.findFirst({
            where: {
                targetSubmissionId: submissionId,
                status: { in: ["REQUESTED", "QUARANTINED", "FAILED"] },
            },
            orderBy: { requestedAt: "desc" },
        });
        if (existing)
            return existing;
        const blockers = purgeBlockers(submission);
        if (blockers.length > 0)
            throw new SubmissionPurgeNotEligibleError(blockers);
        const requestId = randomUUID();
        const authorizationId = requireAuthorizationId(options.authorizationId, requestAuthorizationId(requestId));
        const request = await transaction.submissionPurgeRequest.create({
            data: {
                id: requestId,
                targetSubmissionId: submissionId,
                submissionId,
                requestedById: requesterId,
                status: "REQUESTED",
                reason,
                policyVersion: RETENTION_POLICY_VERSION,
            },
        });
        await audit(transaction, {
            targetSubmissionId: submissionId,
            submissionId,
            purgeRequestId: request.id,
            actorId: requesterId,
            action: "PURGE_REQUESTED",
            authorizationId,
            reason,
            outcome: "REQUESTED",
        });
        return request;
    });
}
/** Place an eligible Submission in its recoverable quarantine. */
export async function approveSubmissionPurge(requestId, approverId, options, dependencies = {}) {
    const reason = requireReason(options.reason);
    const database = databaseOf(dependencies);
    const now = nowOf(dependencies);
    return database.$transaction(async (transaction) => {
        await assertActiveAdmin(transaction, approverId);
        await transaction.$queryRaw `
      SELECT "id" FROM "SubmissionPurgeRequest" WHERE "id" = ${requestId}::uuid FOR UPDATE
    `;
        const request = await transaction.submissionPurgeRequest.findUnique({
            where: { id: requestId },
            select: {
                id: true,
                targetSubmissionId: true,
                submissionId: true,
                requestedById: true,
                status: true,
            },
        });
        if (!request) {
            throw new RetentionOperationError("PURGE_REQUEST_NOT_FOUND", "Purge request not found");
        }
        if (request.status !== "REQUESTED")
            return request;
        if (request.requestedById === approverId) {
            throw new RetentionOperationError("DUAL_CONTROL_REQUIRED", "The requester cannot approve the same purge request");
        }
        await transaction.$queryRaw `
      SELECT "id" FROM "Submission" WHERE "id" = ${request.targetSubmissionId}::uuid FOR UPDATE
    `;
        const submission = await loadSubmissionPolicy(transaction, request.targetSubmissionId);
        if (!submission) {
            throw new RetentionOperationError("SUBMISSION_NOT_FOUND", "Submission not found");
        }
        const blockers = purgeBlockers(submission);
        if (blockers.length > 0)
            throw new SubmissionPurgeNotEligibleError(blockers);
        const quarantineUntil = new Date(now.getTime() + RETENTION_QUARANTINE_MS);
        const approvalAuthorization = requireAuthorizationId(options.authorizationId, approvalAuthorizationId(request.id));
        await transaction.submission.update({
            where: { id: request.targetSubmissionId },
            data: { retentionStatus: "QUARANTINED" },
        });
        await transaction.submissionPurgeRequest.update({
            where: { id: request.id },
            data: {
                status: "QUARANTINED",
                approvedById: approverId,
                approvedAt: now,
                quarantineUntil,
                lastError: null,
            },
        });
        const answers = await transaction.answer.findMany({
            where: { submissionId: request.targetSubmissionId },
            select: { storageKey: true, bucket: true },
            orderBy: { storageKey: "asc" },
        });
        const uniqueObjects = new Map();
        for (const answer of answers) {
            const bucket = answer.bucket ?? env.R2_BUCKET_NAME;
            uniqueObjects.set(`${bucket}\u0000${answer.storageKey}`, {
                storageKey: answer.storageKey,
                bucket,
            });
        }
        for (const object of uniqueObjects.values()) {
            await transaction.submissionPurgeObject.create({
                data: {
                    id: randomUUID(),
                    requestId: request.id,
                    targetSubmissionId: request.targetSubmissionId,
                    submissionId: request.targetSubmissionId,
                    kind: "ANSWER_MEDIA",
                    storageKey: object.storageKey,
                    bucket: object.bucket,
                    status: "QUARANTINED",
                    quarantineUntil,
                },
            });
        }
        await audit(transaction, {
            targetSubmissionId: request.targetSubmissionId,
            submissionId: request.targetSubmissionId,
            purgeRequestId: request.id,
            actorId: approverId,
            action: "PURGE_APPROVED",
            authorizationId: approvalAuthorization,
            reason,
            outcome: "QUARANTINED",
            metadata: {
                answerMediaObjectCount: uniqueObjects.size,
                quarantineUntil: quarantineUntil.toISOString(),
            },
        });
        return transaction.submissionPurgeRequest.findUniqueOrThrow({
            where: { id: request.id },
            include: { objects: { orderBy: { storageKey: "asc" } } },
        });
    });
}
/** Add an explicit hold that prevents a Submission purge. */
export async function createRetentionHold(submissionId, actorId, type, reasonInput, dependencies = {}) {
    const reason = requireReason(reasonInput);
    const database = databaseOf(dependencies);
    return database.$transaction(async (transaction) => {
        await assertActiveAdmin(transaction, actorId);
        await transaction.$queryRaw `
      SELECT "id" FROM "Submission" WHERE "id" = ${submissionId}::uuid FOR UPDATE
    `;
        const submission = await loadSubmissionPolicy(transaction, submissionId);
        if (!submission) {
            throw new RetentionOperationError("SUBMISSION_NOT_FOUND", "Submission not found");
        }
        const hold = await transaction.submissionRetentionHold.create({
            data: {
                id: randomUUID(),
                targetSubmissionId: submissionId,
                submissionId,
                type,
                reason,
                createdById: actorId,
            },
        });
        await audit(transaction, {
            targetSubmissionId: submissionId,
            submissionId,
            actorId,
            action: "RETENTION_HOLD_CREATED",
            authorizationId: `retention-hold:${hold.id}`,
            reason,
            outcome: type,
            metadata: { holdId: hold.id },
        });
        return hold;
    });
}
/** Release a hold after the operator has addressed its reason. */
export async function releaseRetentionHold(holdId, actorId, reasonInput, dependencies = {}) {
    const reason = requireReason(reasonInput);
    const database = databaseOf(dependencies);
    return database.$transaction(async (transaction) => {
        await assertActiveAdmin(transaction, actorId);
        await transaction.$queryRaw `
      SELECT "id" FROM "SubmissionRetentionHold" WHERE "id" = ${holdId}::uuid FOR UPDATE
    `;
        const hold = await transaction.submissionRetentionHold.findUnique({
            where: { id: holdId },
        });
        if (!hold)
            throw new RetentionOperationError("HOLD_NOT_FOUND", "Retention hold not found");
        if (hold.releasedAt)
            return hold;
        const releasedAt = nowOf(dependencies);
        const released = await transaction.submissionRetentionHold.update({
            where: { id: holdId },
            data: { releasedAt, releasedById: actorId },
        });
        await audit(transaction, {
            targetSubmissionId: hold.targetSubmissionId,
            submissionId: hold.submissionId ?? undefined,
            actorId,
            action: "RETENTION_HOLD_RELEASED",
            authorizationId: `retention-hold-release:${hold.id}`,
            reason,
            outcome: hold.type,
            metadata: { holdId: hold.id, releasedAt: releasedAt.toISOString() },
        });
        return released;
    });
}
/** Recover an approved purge before any storage deletion is confirmed. */
export async function cancelSubmissionPurge(requestId, actorId, options, dependencies = {}) {
    const reason = requireReason(options.reason);
    const database = databaseOf(dependencies);
    return database.$transaction(async (transaction) => {
        await assertActiveAdmin(transaction, actorId);
        await transaction.$queryRaw `
      SELECT "id" FROM "SubmissionPurgeRequest" WHERE "id" = ${requestId}::uuid FOR UPDATE
    `;
        const request = await transaction.submissionPurgeRequest.findUnique({
            where: { id: requestId },
            include: { objects: true },
        });
        if (!request) {
            throw new RetentionOperationError("PURGE_REQUEST_NOT_FOUND", "Purge request not found");
        }
        if (request.status === "CANCELLED")
            return request;
        if (request.status !== "QUARANTINED" && request.status !== "FAILED") {
            throw new RetentionOperationError("PURGE_NOT_RECOVERABLE", "Only an approved quarantined or failed purge can be recovered");
        }
        if (request.objects.some((object) => object.status === "DELETED")) {
            throw new RetentionOperationError("PURGE_IRREVERSIBLE", "Recovery is unavailable after storage confirms an object absent");
        }
        if (request.objects.some((object) => object.status === "DELETE_PENDING")) {
            throw new RetentionOperationError("PURGE_DELETE_IN_FLIGHT", "Recovery is unavailable while a storage deletion attempt is pending");
        }
        await transaction.$queryRaw `
      SELECT "id" FROM "Submission" WHERE "id" = ${request.targetSubmissionId}::uuid FOR UPDATE
    `;
        await transaction.submission.updateMany({
            where: { id: request.targetSubmissionId, retentionStatus: "QUARANTINED" },
            data: { retentionStatus: "RETAINED" },
        });
        await transaction.submissionPurgeObject.updateMany({
            where: { requestId: request.id, status: "QUARANTINED" },
            data: { status: "CANCELLED" },
        });
        const cancelled = await transaction.submissionPurgeRequest.update({
            where: { id: request.id },
            data: { status: "CANCELLED", lastError: null },
        });
        await audit(transaction, {
            targetSubmissionId: request.targetSubmissionId,
            submissionId: request.submissionId ?? undefined,
            purgeRequestId: request.id,
            actorId,
            action: "PURGE_CANCELLED",
            authorizationId: requireAuthorizationId(options.authorizationId, `purge-recovery:${request.id}`),
            reason,
            outcome: "RECOVERED",
        });
        await audit(transaction, {
            targetSubmissionId: request.targetSubmissionId,
            submissionId: request.submissionId ?? undefined,
            purgeRequestId: request.id,
            actorId,
            action: "PURGE_RECOVERED",
            authorizationId: `purge-recovery:${request.id}`,
            reason,
            outcome: "RETAINED",
        });
        return cancelled;
    });
}
async function preparePurgeObjectAttempt(requestId, objectId, actorId, reason, authorizationId, dependencies) {
    const database = databaseOf(dependencies);
    return database.$transaction(async (transaction) => {
        await transaction.$queryRaw `
      SELECT "id" FROM "SubmissionPurgeRequest" WHERE "id" = ${requestId}::uuid FOR UPDATE
    `;
        const request = await transaction.submissionPurgeRequest.findUnique({
            where: { id: requestId },
            select: { targetSubmissionId: true, status: true },
        });
        if (!request || (request.status !== "QUARANTINED" && request.status !== "FAILED")) {
            return null;
        }
        await transaction.$queryRaw `
      SELECT "id" FROM "Submission" WHERE "id" = ${request.targetSubmissionId}::uuid FOR UPDATE
    `;
        const submission = await loadSubmissionPolicy(transaction, request.targetSubmissionId);
        if (!submission)
            return null;
        const holdBlockers = activeHoldBlockers(submission);
        if (holdBlockers.length > 0) {
            throw new SubmissionPurgeNotEligibleError(holdBlockers);
        }
        const object = await transaction.submissionPurgeObject.findUnique({
            where: { id: objectId },
        });
        if (!object ||
            object.requestId !== requestId ||
            (object.status !== "QUARANTINED" &&
                object.status !== "FAILED" &&
                object.status !== "DELETE_PENDING")) {
            return null;
        }
        const attempted = await transaction.submissionPurgeObject.update({
            where: { id: object.id },
            data: {
                status: "DELETE_PENDING",
                attemptCount: { increment: 1 },
                lastError: null,
            },
        });
        await audit(transaction, {
            targetSubmissionId: object.targetSubmissionId,
            submissionId: object.submissionId ?? undefined,
            purgeRequestId: requestId,
            actorId,
            action: "PURGE_DELETE_ATTEMPTED",
            authorizationId,
            reason,
            storageKey: object.storageKey,
            outcome: "DELETE_REQUESTED",
            metadata: { attemptCount: attempted.attemptCount },
        });
        return {
            id: object.id,
            requestId,
            submissionId: object.targetSubmissionId,
            storageKey: object.storageKey,
            bucket: object.bucket,
        };
    });
}
async function markPurgeObjectFailure(attempt, actorId, reason, authorizationId, error, dependencies) {
    const database = databaseOf(dependencies);
    const message = error instanceof Error ? error.message : "Storage deletion failed";
    await database.$transaction(async (transaction) => {
        await transaction.submissionPurgeObject.updateMany({
            where: { id: attempt.id, status: "DELETE_PENDING" },
            data: { status: "FAILED", lastError: message },
        });
        await transaction.submissionPurgeRequest.updateMany({
            where: {
                id: attempt.requestId,
                status: { in: ["QUARANTINED", "FAILED"] },
            },
            data: { status: "FAILED", lastError: message },
        });
        await audit(transaction, {
            targetSubmissionId: attempt.submissionId,
            submissionId: attempt.submissionId,
            purgeRequestId: attempt.requestId,
            actorId,
            action: "PURGE_DELETE_FAILED",
            authorizationId,
            reason,
            storageKey: attempt.storageKey,
            outcome: message,
        });
    });
}
async function markPurgeObjectConfirmed(attempt, confirmation, actorId, reason, authorizationId, dependencies) {
    const database = databaseOf(dependencies);
    await database.$transaction(async (transaction) => {
        await transaction.submissionPurgeObject.updateMany({
            where: { id: attempt.id, status: "DELETE_PENDING" },
            data: { status: "DELETED", deletedAt: nowOf(dependencies), lastError: null },
        });
        await audit(transaction, {
            targetSubmissionId: attempt.submissionId,
            submissionId: attempt.submissionId,
            purgeRequestId: attempt.requestId,
            actorId,
            action: "PURGE_DELETE_CONFIRMED",
            authorizationId,
            reason,
            storageKey: attempt.storageKey,
            outcome: confirmation.outcome,
        });
    });
}
async function completeSubmissionPurge(requestId, actorId, reason, authorizationId, dependencies) {
    const database = databaseOf(dependencies);
    await database.$transaction(async (transaction) => {
        await transaction.$queryRaw `
      SELECT "id" FROM "SubmissionPurgeRequest" WHERE "id" = ${requestId}::uuid FOR UPDATE
    `;
        const request = await transaction.submissionPurgeRequest.findUnique({
            where: { id: requestId },
            include: { objects: true },
        });
        if (!request || request.status === "CANCELLED" || request.status === "COMPLETED")
            return;
        if (request.objects.some((object) => object.status !== "DELETED")) {
            throw new RetentionOperationError("PURGE_OBJECTS_INCOMPLETE", "Every captured Answer-media object must be storage-confirmed before database evidence is removed");
        }
        await transaction.$queryRaw `
      SELECT "id" FROM "Submission" WHERE "id" = ${request.targetSubmissionId}::uuid FOR UPDATE
    `;
        const submission = await loadSubmissionPolicy(transaction, request.targetSubmissionId);
        if (!submission)
            return;
        const blockers = [
            ...activeHoldBlockers(submission),
            ...(submission.payments.some((payment) => payment.status !== "FAILED" && payment.status !== "REFUNDED")
                ? ["A payment obligation appeared during purge finalization"]
                : []),
            ...(submission.assignments.length > 0 ? ["Examiner assignments appeared during purge finalization"] : []),
            ...(submission.certificate ? ["A certificate appeared during purge finalization"] : []),
        ];
        if (blockers.length > 0)
            throw new SubmissionPurgeNotEligibleError(blockers);
        // This setting is transaction-local and is accepted only while this
        // request is QUARANTINED. It is the sole escape hatch from the ordinary
        // manifest immutability triggers.
        await transaction.submissionPurgeRequest.update({
            where: { id: request.id },
            data: { status: "QUARANTINED", lastError: null },
        });
        await transaction.$executeRaw `
      SELECT set_config('fluentcheck.retention_purge_request_id', ${request.id}, true)
    `;
        await transaction.answer.deleteMany({ where: { submissionId: request.targetSubmissionId } });
        await transaction.$executeRaw `
      DELETE FROM "ManifestTask"
       WHERE "manifestEntryId" IN (
         SELECT "id" FROM "ManifestEntry" WHERE "submissionId" = ${request.targetSubmissionId}::uuid
       )
    `;
        await transaction.manifestEntry.deleteMany({
            where: { submissionId: request.targetSubmissionId },
        });
        await transaction.submissionManifest.deleteMany({
            where: { submissionId: request.targetSubmissionId },
        });
        await transaction.submissionStartIntent.deleteMany({
            where: { submissionId: request.targetSubmissionId },
        });
        await transaction.payment.deleteMany({
            where: {
                submissionId: request.targetSubmissionId,
                status: { in: ["FAILED", "REFUNDED"] },
            },
        });
        await transaction.submission.update({
            where: { id: request.targetSubmissionId },
            data: { retentionStatus: "PURGED" },
        });
        await audit(transaction, {
            targetSubmissionId: request.targetSubmissionId,
            submissionId: request.targetSubmissionId,
            purgeRequestId: request.id,
            actorId,
            action: "PURGE_COMPLETED",
            authorizationId,
            reason,
            outcome: "IRREVERSIBLE_EVIDENCE_REMOVED",
            metadata: { answerMediaObjectCount: request.objects.length },
        });
        await transaction.submissionPurgeRequest.update({
            where: { id: request.id },
            data: {
                status: "COMPLETED",
                completedAt: nowOf(dependencies),
                lastError: null,
            },
        });
        await transaction.submission.delete({ where: { id: request.targetSubmissionId } });
    });
}
/**
 * Delete captured Answer media only after quarantine and confirmation, then
 * remove the purgeable relational evidence in one authorized transaction.
 * Failed objects remain FAILED and can be retried by calling this operation.
 */
export async function finalizeSubmissionPurge(requestId, actorId, options, dependencies = {}) {
    assertCleanupEnabled(dependencies);
    const reason = requireReason(options.reason);
    const database = databaseOf(dependencies);
    const now = nowOf(dependencies);
    await database.$transaction(async (transaction) => {
        await assertActiveAdmin(transaction, actorId);
        const request = await transaction.submissionPurgeRequest.findUnique({
            where: { id: requestId },
            include: { objects: true },
        });
        if (!request) {
            throw new RetentionOperationError("PURGE_REQUEST_NOT_FOUND", "Purge request not found");
        }
        if (request.status === "COMPLETED" || request.status === "CANCELLED")
            return;
        if (request.status === "REQUESTED") {
            throw new RetentionOperationError("PURGE_NOT_APPROVED", "Purge approval is required before finalization");
        }
        if (!request.quarantineUntil || request.quarantineUntil.getTime() > now.getTime()) {
            throw new RetentionOperationError("PURGE_QUARANTINE_ACTIVE", "The Submission quarantine boundary has not elapsed", { quarantineUntil: request.quarantineUntil });
        }
    });
    const authorizationId = requireAuthorizationId(options.authorizationId, resultAuthorizationId(requestId));
    const request = await database.submissionPurgeRequest.findUniqueOrThrow({
        where: { id: requestId },
        include: { objects: { orderBy: { storageKey: "asc" } } },
    });
    const storage = storageOf(dependencies);
    let failed = false;
    let failure;
    for (const object of request.objects) {
        if (object.status === "DELETED" || object.status === "CANCELLED")
            continue;
        let attempt = null;
        try {
            attempt = await preparePurgeObjectAttempt(requestId, object.id, actorId, reason, authorizationId, dependencies);
            if (!attempt)
                continue;
            const confirmation = await storage.deleteObject(attempt.storageKey, attempt.bucket);
            await markPurgeObjectConfirmed(attempt, confirmation, actorId, reason, authorizationId, dependencies);
        }
        catch (error) {
            failed = true;
            failure ??= error;
            if (attempt) {
                await markPurgeObjectFailure(attempt, actorId, reason, authorizationId, error, dependencies);
            }
        }
    }
    if (failed) {
        return database.submissionPurgeRequest.findUniqueOrThrow({
            where: { id: requestId },
            include: { objects: { orderBy: { storageKey: "asc" } } },
        });
    }
    try {
        await completeSubmissionPurge(requestId, actorId, reason, authorizationId, dependencies);
    }
    catch (error) {
        failure = error;
        const message = error instanceof Error ? error.message : "Purge finalization failed";
        await database.$transaction(async (transaction) => {
            await transaction.submissionPurgeRequest.updateMany({
                where: { id: requestId, status: { in: ["QUARANTINED", "FAILED"] } },
                data: { status: "FAILED", lastError: message },
            });
            const current = await transaction.submissionPurgeRequest.findUnique({
                where: { id: requestId },
                select: { targetSubmissionId: true, submissionId: true },
            });
            await audit(transaction, {
                targetSubmissionId: current?.targetSubmissionId,
                submissionId: current?.submissionId ?? undefined,
                purgeRequestId: requestId,
                actorId,
                action: "PURGE_DELETE_FAILED",
                authorizationId,
                reason,
                outcome: message,
            });
        });
    }
    // Keep the failure value available in a debugger without exposing storage
    // provider internals in the normal machine-readable return value.
    void failure;
    return database.submissionPurgeRequest.findUniqueOrThrow({
        where: { id: requestId },
        include: { objects: { orderBy: { storageKey: "asc" } } },
    });
}
export async function getSubmissionPurgeRequest(requestId, dependencies = {}) {
    return databaseOf(dependencies).submissionPurgeRequest.findUnique({
        where: { id: requestId },
        include: { objects: { orderBy: { storageKey: "asc" } }, auditEvents: { orderBy: { createdAt: "asc" } } },
    });
}
