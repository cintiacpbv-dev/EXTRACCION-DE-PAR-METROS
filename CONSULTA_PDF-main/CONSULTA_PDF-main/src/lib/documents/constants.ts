export const DOCUMENTS_BUCKET = 'documents';
export const COVERS_BUCKET = 'covers';

export const ALLOWED_MIME_TYPES = ['application/pdf'] as const;

export const MAX_UPLOAD_SIZE_BYTES = 300 * 1024 * 1024; // 300 MB

export function storagePathFor(documentId: string) {
  return `${documentId}/original.pdf`;
}

export function coverPathFor(documentId: string) {
  return `${documentId}/cover.png`;
}
