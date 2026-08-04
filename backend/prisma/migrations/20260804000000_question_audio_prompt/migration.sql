-- AlterTable
ALTER TABLE "Question" DROP COLUMN "promptText",
ADD COLUMN     "audioMimeType" TEXT,
ADD COLUMN     "audioSizeBytes" INTEGER,
ADD COLUMN     "audioStorageKey" TEXT,
ADD COLUMN     "audioUploadStatus" "UploadStatus" NOT NULL DEFAULT 'PENDING';
