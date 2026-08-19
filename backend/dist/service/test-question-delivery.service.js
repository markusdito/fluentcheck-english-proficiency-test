export async function buildTestQuestionDelivery(questions, signQuestionAudio) {
    return Promise.all(questions.map(async (question) => {
        let audioUrl = null;
        if (question.audioUploadStatus === "UPLOADED" &&
            question.audioStorageKey) {
            try {
                audioUrl = await signQuestionAudio(question.audioStorageKey, question.audioMimeType);
            }
            catch {
                audioUrl = null;
            }
        }
        return {
            id: question.id,
            category: question.category,
            order: question.order,
            preparationSeconds: question.preparationSeconds,
            recordingSeconds: question.recordingSeconds,
            audioUploadStatus: question.audioUploadStatus,
            audioUrl,
            tasks: question.tasks,
        };
    }));
}
