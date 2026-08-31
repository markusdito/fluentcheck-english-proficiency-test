import { isValidPromptMediaUrl, ManifestEvidenceUnavailableError, } from "./submissionManifestDelivery.service.js";
export async function buildTestQuestionDelivery(questions, signQuestionAudio) {
    const attempts = await Promise.all(questions.map(async (question) => {
        const missingMedia = question.audioUploadStatus !== "UPLOADED" ||
            !question.audioStorageKey ||
            !question.audioMimeType;
        if (missingMedia) {
            return {
                question,
                failure: {
                    entryId: question.id,
                    category: question.category,
                    reason: "MISSING_MEDIA_METADATA",
                },
            };
        }
        try {
            const audioUrl = await signQuestionAudio(question.audioStorageKey, question.audioMimeType);
            if (!isValidPromptMediaUrl(audioUrl)) {
                return {
                    question,
                    failure: {
                        entryId: question.id,
                        category: question.category,
                        reason: "INVALID_SIGNED_URL",
                    },
                };
            }
            return { question, audioUrl };
        }
        catch {
            return {
                question,
                failure: {
                    entryId: question.id,
                    category: question.category,
                    reason: "SIGNING_FAILED",
                },
            };
        }
    }));
    const failures = attempts.flatMap((attempt) => attempt.failure ? [attempt.failure] : []);
    if (failures.length > 0) {
        throw new ManifestEvidenceUnavailableError("Prompt media unavailable", {
            operation: "prompt-media-signing",
            failureCount: failures.length,
            failures,
        });
    }
    return attempts.map((attempt) => {
        if (!attempt.audioUrl) {
            throw new ManifestEvidenceUnavailableError("Prompt media unavailable");
        }
        const { question } = attempt;
        return {
            id: question.id,
            category: question.category,
            order: question.order,
            preparationSeconds: question.preparationSeconds,
            recordingSeconds: question.recordingSeconds,
            audioUploadStatus: question.audioUploadStatus,
            audioUrl: attempt.audioUrl,
            tasks: question.tasks,
        };
    });
}
