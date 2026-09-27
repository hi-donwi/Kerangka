/**
 * Kerangka Files (Blob Storage) Port Contract
 * Specification Version: 0.1
 * Status: Draft
 * License: Apache-2.0
 */

export interface FileUploadOptions {
  contentType?: string;
  metadata?: Record<string, string>;
  isPublic?: boolean;
}

export interface FileDescriptor {
  path: string;
  url: string;
  size: number;
  contentType?: string;
  updatedAt: string;
}

export interface FilesPort {
  /**
   * Uploads raw binary content to the storage bucket at the given path.
   */
  upload(
    path: string,
    content: Uint8Array | ArrayBuffer | string,
    options?: FileUploadOptions
  ): Promise<FileDescriptor>;

  /**
   * Downloads content from the given path as bytes.
   */
  download(path: string): Promise<Uint8Array | null>;

  /**
   * Deletes a file at the specified path.
   */
  delete(path: string): Promise<void>;

  /**
   * Generates a pre-signed URL for direct download or upload.
   */
  getSignedUrl?(path: string, expiresInSeconds?: number): Promise<string>;
}
