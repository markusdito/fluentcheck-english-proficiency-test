/**
 * Serialize every database mutation that can create or remove a reference to
 * one Prompt-media identity. The matching PostgreSQL trigger also acquires
 * this lock for direct database writes.
 */
export async function lockPromptMediaStorageIdentity(transaction, storageKey) {
    if (!storageKey)
        return;
    await transaction.$executeRaw `
    SELECT lock_prompt_media_storage_identity(${storageKey})
  `;
}
