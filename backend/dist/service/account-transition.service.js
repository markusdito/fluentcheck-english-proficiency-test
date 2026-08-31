import { Prisma } from "../generated/client.js";
import { prisma } from "../config/db.js";
/** One lock shared by role/deactivation and assignment-set creation. */
export const ACCOUNT_TRANSITION_ADVISORY_LOCK_KEY = BigInt("584329157");
const ROLE_VALUES = ["STUDENT", "EXAMINER", "ADMIN"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACCOUNT_TRANSITION_TRANSACTION_ATTEMPTS = 3;
export class AccountTransitionError extends Error {
    code;
    details;
    constructor(code, message, details) {
        super(message);
        this.name = "AccountTransitionError";
        this.code = code;
        this.details = details;
    }
}
function isRole(value) {
    return typeof value === "string" && ROLE_VALUES.includes(value);
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function parseReassignmentMap(value) {
    if (value === undefined)
        return {};
    if (!isRecord(value)) {
        throw new AccountTransitionError("INVALID_REASSIGNMENT", "Reassignment map must be an object");
    }
    const parsed = {};
    for (const [assignmentId, examinerId] of Object.entries(value)) {
        if (!UUID_RE.test(assignmentId) || typeof examinerId !== "string" || !UUID_RE.test(examinerId)) {
            throw new AccountTransitionError("INVALID_REASSIGNMENT", "Reassignment map must contain valid assignment and examiner IDs");
        }
        parsed[assignmentId] = examinerId;
    }
    const replacementIds = Object.values(parsed);
    if (new Set(replacementIds).size !== replacementIds.length) {
        throw new AccountTransitionError("INVALID_REASSIGNMENT", "Each replacement examiner must be assigned at most once");
    }
    return parsed;
}
function userResult(outcome, user, assignments = []) {
    return {
        outcome,
        user: {
            id: user.id,
            username: user.username,
            email: user.email,
            role: user.role,
            createdAt: user.createdAt,
            deletedAt: user.deletedAt,
        },
        assignments,
    };
}
function isContention(error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError))
        return false;
    if (error.code === "P2034" || error.code === "P2024")
        return true;
    // PostgreSQL serialization failures raised by a raw FOR UPDATE query are
    // wrapped as P2010 rather than Prisma's usual P2034 transaction error.
    return (error.code === "P2010" &&
        /(?:40001|serialization failure|could not serialize access|deadlock detected)/iu.test(error.message));
}
function contentionConflict(operation) {
    return new AccountTransitionError("REASSIGNMENT_CONFLICT", `Account ${operation} could not be committed because the account state changed concurrently`);
}
async function runSerializableTransition(database, operation, callback) {
    for (let attempt = 1; attempt <= ACCOUNT_TRANSITION_TRANSACTION_ATTEMPTS; attempt += 1) {
        try {
            return await database.$transaction(callback, {
                isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
            });
        }
        catch (error) {
            if (!isContention(error))
                throw error;
            if (attempt === ACCOUNT_TRANSITION_TRANSACTION_ATTEMPTS) {
                throw contentionConflict(operation);
            }
        }
    }
    throw contentionConflict(operation);
}
function requiresAssignmentTransfer(currentRole, requestedRole, deactivate) {
    return (deactivate ||
        (requestedRole === "STUDENT" &&
            (currentRole === "EXAMINER" || currentRole === "ADMIN")));
}
async function lockUsers(tx, ids) {
    const locked = new Map();
    for (const id of [...new Set(ids)].sort()) {
        const rows = await tx.$queryRaw `
      SELECT
        "id"::text AS "id",
        "username",
        "email",
        "role"::text AS "role",
        "createdAt",
        "deletedAt"
        FROM "User"
       WHERE "id" = ${id}::uuid
       FOR UPDATE
    `;
        if (rows[0])
            locked.set(id, rows[0]);
    }
    return locked;
}
async function lockSubmissions(tx, ids) {
    for (const id of [...new Set(ids)].sort()) {
        await tx.$queryRaw `
      SELECT "id"
        FROM "Submission"
       WHERE "id" = ${id}::uuid
       FOR UPDATE
    `;
    }
}
async function lockAssignments(tx, ids) {
    for (const id of [...new Set(ids)].sort()) {
        await tx.$queryRaw `
      SELECT "id"
        FROM "ExaminerAssignment"
       WHERE "id" = ${id}::uuid
       FOR UPDATE
    `;
    }
}
async function readTargetAssignments(tx, targetUserId) {
    return tx.examinerAssignment.findMany({
        where: { examinerId: targetUserId },
        orderBy: { id: "asc" },
        select: {
            id: true,
            submissionId: true,
            examinerId: true,
            slot: true,
            status: true,
            createdAt: true,
            scores: { select: { id: true } },
        },
    });
}
function validateAssignmentSets(assignments) {
    const bySubmission = new Map();
    for (const assignment of assignments) {
        const group = bySubmission.get(assignment.submissionId) ?? [];
        group.push(assignment);
        bySubmission.set(assignment.submissionId, group);
    }
    const invalidGroups = [...bySubmission.values()].filter((group) => {
        const slots = new Set(group.map(({ slot }) => slot));
        const examiners = new Set(group.map(({ examinerId }) => examinerId));
        return (group.length !== 2 ||
            slots.size !== 2 ||
            !slots.has(1) ||
            !slots.has(2) ||
            examiners.size !== 2);
    });
    if (invalidGroups.length === 0)
        return;
    const invalidAssignments = invalidGroups.flat();
    throw new AccountTransitionError("REASSIGNMENT_CONFLICT", "Examiner assignment set is invalid and requires data repair", {
        assignmentIds: invalidAssignments.map(({ id }) => id),
        statuses: invalidAssignments.map(({ status }) => status),
    });
}
function assignmentSummary(assignment, previousExaminerId, newExaminerId) {
    return {
        id: assignment.id,
        submissionId: assignment.submissionId,
        slot: assignment.slot,
        status: assignment.status,
        previousExaminerId,
        newExaminerId,
        scoreCount: assignment.scores.length,
        createdAt: assignment.createdAt,
    };
}
function validateExactMap(assignments, reassignmentMap) {
    const expected = new Set(assignments.map(({ id }) => id));
    const actual = new Set(Object.keys(reassignmentMap));
    if (expected.size !== actual.size ||
        [...expected].some((assignmentId) => !actual.has(assignmentId))) {
        throw new AccountTransitionError("INVALID_REASSIGNMENT", "Every transferable assignment must have exactly one replacement examiner", { assignmentIds: assignments.map(({ id }) => id) });
    }
}
async function readReplayHistory(tx, targetUserId, reassignmentMap, reason) {
    const assignmentIds = Object.keys(reassignmentMap);
    if (assignmentIds.length === 0)
        return [];
    const history = await tx.examinerAssignmentReassignment.findMany({
        where: { previousExaminerId: targetUserId, reason },
        orderBy: [{ createdAt: "desc" }, { assignmentId: "asc" }],
        select: {
            id: true,
            assignmentId: true,
            previousExaminerId: true,
            newExaminerId: true,
            actingAdminId: true,
            reason: true,
            createdAt: true,
        },
    });
    const historicalAssignmentIds = new Set(history.map((entry) => entry.assignmentId));
    if (historicalAssignmentIds.size > 0) {
        const suppliedAssignmentIds = new Set(assignmentIds);
        if (historicalAssignmentIds.size !== suppliedAssignmentIds.size ||
            [...historicalAssignmentIds].some((assignmentId) => !suppliedAssignmentIds.has(assignmentId))) {
            throw new AccountTransitionError("INVALID_REASSIGNMENT", "Every reassignment from the account's completed transitions must be included", { assignmentIds: [...historicalAssignmentIds].sort() });
        }
    }
    const assignments = await tx.examinerAssignment.findMany({
        where: { id: { in: assignmentIds } },
        orderBy: { id: "asc" },
        select: {
            id: true,
            submissionId: true,
            slot: true,
            status: true,
            createdAt: true,
            examinerId: true,
            scores: { select: { id: true } },
        },
    });
    if (assignments.length !== assignmentIds.length)
        return null;
    const latestHistoryByAssignment = new Map();
    for (const entry of history) {
        if (!latestHistoryByAssignment.has(entry.assignmentId)) {
            latestHistoryByAssignment.set(entry.assignmentId, entry);
        }
    }
    if (assignments.some((assignment) => assignment.examinerId !== reassignmentMap[assignment.id] ||
        latestHistoryByAssignment.get(assignment.id)?.newExaminerId !==
            reassignmentMap[assignment.id])) {
        return null;
    }
    return assignments.map((assignment) => assignmentSummary(assignment, targetUserId, reassignmentMap[assignment.id]));
}
async function transitionInsideTransaction(tx, targetUserId, actorUserId, requestedRole, deactivate, reassignmentMap) {
    await tx.$executeRaw `
    SELECT pg_advisory_xact_lock(${ACCOUNT_TRANSITION_ADVISORY_LOCK_KEY})
  `;
    const users = await lockUsers(tx, [
        targetUserId,
        actorUserId,
        ...Object.values(reassignmentMap),
    ]);
    const target = users.get(targetUserId);
    const actor = users.get(actorUserId);
    if (!actor || actor.deletedAt !== null || actor.role !== "ADMIN") {
        throw new AccountTransitionError("UNAUTHORIZED", "Only an active administrator can transition accounts");
    }
    if (!target) {
        throw new AccountTransitionError("USER_NOT_FOUND", "User not found", { userId: targetUserId });
    }
    if (target.deletedAt !== null) {
        if (!deactivate) {
            throw new AccountTransitionError("USER_NOT_FOUND", "User not found", { userId: targetUserId });
        }
        if (Object.keys(reassignmentMap).length === 0) {
            return userResult("ALREADY_APPLIED", target);
        }
        const replay = await readReplayHistory(tx, targetUserId, reassignmentMap, "ACCOUNT_DEACTIVATION");
        if (!replay) {
            throw new AccountTransitionError("REASSIGNMENT_CONFLICT", "The requested reassignment is not the committed account state");
        }
        return userResult("ALREADY_APPLIED", target, replay);
    }
    if (!deactivate && target.role === requestedRole) {
        if (Object.keys(reassignmentMap).length === 0) {
            return userResult("ALREADY_APPLIED", target);
        }
        const replay = await readReplayHistory(tx, targetUserId, reassignmentMap, "ACCOUNT_ROLE_TRANSITION");
        if (replay)
            return userResult("ALREADY_APPLIED", target, replay);
        throw new AccountTransitionError("REASSIGNMENT_CONFLICT", "The requested reassignment is not the committed account state");
    }
    if (target.role === "ADMIN" &&
        (deactivate || requestedRole !== "ADMIN")) {
        const activeAdminCount = await tx.user.count({
            where: { role: "ADMIN", deletedAt: null },
        });
        if (activeAdminCount <= 1) {
            throw new AccountTransitionError("LAST_ACTIVE_ADMIN", "Cannot remove the last active administrator", { userId: targetUserId });
        }
    }
    const assignmentRefs = await tx.examinerAssignment.findMany({
        where: { examinerId: targetUserId },
        select: { id: true, submissionId: true },
    });
    await lockSubmissions(tx, assignmentRefs.map(({ submissionId }) => submissionId));
    await lockAssignments(tx, assignmentRefs.map(({ id }) => id));
    const assignments = await readTargetAssignments(tx, targetUserId);
    const submissionIds = [...new Set(assignmentRefs.map(({ submissionId }) => submissionId))];
    const assignmentSetRows = submissionIds.length === 0
        ? []
        : await tx.examinerAssignment.findMany({
            where: { submissionId: { in: submissionIds } },
            select: {
                id: true,
                submissionId: true,
                examinerId: true,
                slot: true,
                status: true,
            },
        });
    validateAssignmentSets(assignmentSetRows);
    const openAssignments = assignments.filter((assignment) => assignment.status === "ASSIGNED" || assignment.status === "IN_PROGRESS");
    const shouldTransfer = requiresAssignmentTransfer(target.role, requestedRole, deactivate);
    if (!shouldTransfer && Object.keys(reassignmentMap).length > 0) {
        throw new AccountTransitionError("INVALID_REASSIGNMENT", "Reassignment is only accepted when Examiner capability is being removed");
    }
    let transferred = [];
    if (shouldTransfer) {
        const inProgress = openAssignments.filter((assignment) => assignment.status === "IN_PROGRESS");
        if (inProgress.length > 0) {
            throw new AccountTransitionError("EXAMINER_ASSIGNMENTS_IN_PROGRESS", "In-progress Examiner assignments must be completed before capability removal", {
                assignmentIds: inProgress.map(({ id }) => id),
                statuses: inProgress.map(({ status }) => status),
            });
        }
        const scoredAssignments = openAssignments.filter((assignment) => assignment.status === "ASSIGNED" && assignment.scores.length > 0);
        if (scoredAssignments.length > 0) {
            throw new AccountTransitionError("EXAMINER_HAS_OPEN_ASSIGNMENTS", "Examiner assignments with saved scores cannot be transferred", {
                assignmentIds: scoredAssignments.map(({ id }) => id),
                statuses: scoredAssignments.map(({ status }) => status),
            });
        }
        const transferable = openAssignments.filter((assignment) => assignment.status === "ASSIGNED" && assignment.scores.length === 0);
        validateExactMap(transferable, reassignmentMap);
        const replacementUsers = new Map();
        for (const replacementId of Object.values(reassignmentMap)) {
            const replacement = users.get(replacementId);
            if (replacement)
                replacementUsers.set(replacementId, replacement);
        }
        const assignmentsBySubmission = new Map();
        for (const assignment of assignmentSetRows) {
            const owners = assignmentsBySubmission.get(assignment.submissionId) ?? new Set();
            owners.add(assignment.examinerId);
            assignmentsBySubmission.set(assignment.submissionId, owners);
        }
        for (const assignment of transferable) {
            const replacementId = reassignmentMap[assignment.id];
            const replacement = replacementUsers.get(replacementId);
            const owners = assignmentsBySubmission.get(assignment.submissionId) ?? new Set();
            if (!replacement ||
                replacement.deletedAt !== null ||
                replacement.role !== "EXAMINER" ||
                replacementId === targetUserId ||
                owners.has(replacementId)) {
                throw new AccountTransitionError("INVALID_REASSIGNMENT", "Replacement examiners must be active, distinct Examiners outside the assignment set", { assignmentIds: [assignment.id] });
            }
        }
        for (const assignment of transferable) {
            const replacementId = reassignmentMap[assignment.id];
            await tx.examinerAssignment.update({
                where: { id: assignment.id },
                data: { examinerId: replacementId },
            });
            await tx.examinerAssignmentReassignment.create({
                data: {
                    assignmentId: assignment.id,
                    previousExaminerId: targetUserId,
                    newExaminerId: replacementId,
                    actingAdminId: actorUserId,
                    reason: deactivate ? "ACCOUNT_DEACTIVATION" : "ACCOUNT_ROLE_TRANSITION",
                },
            });
            transferred.push(assignmentSummary(assignment, targetUserId, replacementId));
        }
    }
    const updated = await tx.user.update({
        where: { id: targetUserId },
        data: {
            role: requestedRole,
            ...(deactivate ? { deletedAt: new Date() } : {}),
        },
        select: {
            id: true,
            username: true,
            email: true,
            role: true,
            createdAt: true,
            deletedAt: true,
        },
    });
    return userResult(deactivate || target.role !== requestedRole ? "UPDATED" : "ALREADY_APPLIED", updated, transferred);
}
/**
 * Change an account's role inside the shared PostgreSQL transition boundary.
 * Every caller uses the same advisory lock and deterministic row-lock order.
 */
export async function transitionAccountRole(targetUserId, actorUserId, requestedRole, options = {}) {
    if (!isRole(requestedRole)) {
        throw new AccountTransitionError("INVALID_ROLE", "Role must be one of STUDENT, EXAMINER, ADMIN");
    }
    if (targetUserId === actorUserId) {
        throw new AccountTransitionError("SELF_ROLE_CHANGE", "Cannot change your own role");
    }
    const reassignmentMap = parseReassignmentMap(options.reassignmentMap);
    const database = options.database ?? prisma;
    return runSerializableTransition(database, "transition", (tx) => transitionInsideTransaction(tx, targetUserId, actorUserId, requestedRole, false, reassignmentMap));
}
/** Shared internal boundary for supported soft-deactivation callers. */
export async function deactivateAccount(targetUserId, actorUserId, options = {}) {
    const reassignmentMap = parseReassignmentMap(options.reassignmentMap);
    const database = options.database ?? prisma;
    return runSerializableTransition(database, "deactivation", async (tx) => {
        await tx.$executeRaw `
      SELECT pg_advisory_xact_lock(${ACCOUNT_TRANSITION_ADVISORY_LOCK_KEY})
    `;
        const targetRows = await tx.$queryRaw `
      SELECT
        "id"::text AS "id",
        "username",
        "email",
        "role"::text AS "role",
        "createdAt",
        "deletedAt"
        FROM "User"
       WHERE "id" = ${targetUserId}::uuid
       FOR UPDATE
    `;
        const target = targetRows[0];
        if (!target) {
            throw new AccountTransitionError("USER_NOT_FOUND", "User not found", { userId: targetUserId });
        }
        const users = await lockUsers(tx, [
            actorUserId,
            ...Object.values(reassignmentMap),
        ]);
        const actor = users.get(actorUserId);
        if (!actor || actor.deletedAt !== null || actor.role !== "ADMIN") {
            throw new AccountTransitionError("UNAUTHORIZED", "Only an active administrator can transition accounts");
        }
        if (targetUserId === actorUserId) {
            throw new AccountTransitionError("SELF_ROLE_CHANGE", "Cannot change your own role");
        }
        return transitionInsideTransaction(tx, targetUserId, actorUserId, target.role, true, reassignmentMap);
    });
}
/** Read-only impact data used to build an exact reassignment map. */
export async function previewAccountRoleTransition(targetUserId, actorUserId, requestedRole, dependencies = {}) {
    if (!isRole(requestedRole)) {
        throw new AccountTransitionError("INVALID_ROLE", "Role must be one of STUDENT, EXAMINER, ADMIN");
    }
    if (targetUserId === actorUserId) {
        throw new AccountTransitionError("SELF_ROLE_CHANGE", "Cannot change your own role");
    }
    const database = dependencies.database ?? prisma;
    const [target, actor] = await Promise.all([
        database.user.findUnique({
            where: { id: targetUserId },
            select: {
                id: true,
                username: true,
                email: true,
                role: true,
                createdAt: true,
                deletedAt: true,
            },
        }),
        database.user.findUnique({
            where: { id: actorUserId },
            select: { role: true, deletedAt: true },
        }),
    ]);
    if (!actor || actor.deletedAt !== null || actor.role !== "ADMIN") {
        throw new AccountTransitionError("UNAUTHORIZED", "Only an active administrator can preview account transitions");
    }
    if (!target || target.deletedAt !== null) {
        throw new AccountTransitionError("USER_NOT_FOUND", "User not found", { userId: targetUserId });
    }
    const assignments = await database.examinerAssignment.findMany({
        where: {
            examinerId: targetUserId,
            status: { in: ["ASSIGNED", "IN_PROGRESS"] },
        },
        orderBy: { id: "asc" },
        select: {
            id: true,
            submissionId: true,
            slot: true,
            status: true,
            createdAt: true,
            examiner: { select: { id: true, username: true, email: true } },
            scores: { select: { id: true } },
        },
    });
    const ownersBySubmission = new Map();
    const submissionIds = [...new Set(assignments.map(({ submissionId }) => submissionId))];
    const assignmentSetRows = submissionIds.length === 0
        ? []
        : await database.examinerAssignment.findMany({
            where: { submissionId: { in: submissionIds } },
            select: { submissionId: true, examinerId: true },
        });
    for (const assignment of assignmentSetRows) {
        const owners = ownersBySubmission.get(assignment.submissionId) ?? new Set();
        owners.add(assignment.examinerId);
        ownersBySubmission.set(assignment.submissionId, owners);
    }
    const eligible = await database.user.findMany({
        where: { role: "EXAMINER", deletedAt: null },
        orderBy: { id: "asc" },
        select: { id: true, username: true, email: true },
    });
    const shouldTransfer = requiresAssignmentTransfer(target.role, requestedRole, false);
    return {
        user: {
            id: target.id,
            username: target.username,
            email: target.email,
            role: target.role,
            createdAt: target.createdAt,
            deletedAt: target.deletedAt,
        },
        requestedRole,
        assignments: assignments.map((assignment) => ({
            id: assignment.id,
            submissionId: assignment.submissionId,
            slot: assignment.slot,
            status: assignment.status,
            createdAt: assignment.createdAt,
            currentExaminer: assignment.examiner,
            scoreCount: assignment.scores.length,
            transferEligible: shouldTransfer && assignment.status === "ASSIGNED" && assignment.scores.length === 0,
            candidates: shouldTransfer && assignment.status === "ASSIGNED" && assignment.scores.length === 0
                ? eligible.filter((candidate) => candidate.id !== targetUserId &&
                    !ownersBySubmission.get(assignment.submissionId)?.has(candidate.id))
                : [],
        })),
    };
}
