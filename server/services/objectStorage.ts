import { Storage, File } from "@google-cloud/storage";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
const publicPaths = process.env.PUBLIC_OBJECT_SEARCH_PATHS?.split(',') || ['public'];
const privateDir = process.env.PRIVATE_OBJECT_DIR || '.private';

if (!bucketId) {
  throw new Error('DEFAULT_OBJECT_STORAGE_BUCKET_ID environment variable is not set');
}

// Initialize Google Cloud Storage client with Replit sidecar authentication
const storageClient = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: {
        type: "json",
        subject_token_field_name: "access_token",
      },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

export interface UploadFileOptions {
  fileName: string;
  fileContent: Buffer;
  mimeType?: string;
  accessLevel: 'public' | 'private';
  customPath?: string;
}

export interface FileMetadata {
  fileName: string;
  storagePath: string;
  size: number;
  mimeType?: string;
  lastModified?: Date;
}

function parseObjectPath(path: string): { bucketName: string; objectName: string } {
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  const pathParts = path.split("/");
  if (pathParts.length < 3) {
    throw new Error("Invalid path: must contain at least a bucket name");
  }

  const bucketName = pathParts[1];
  const objectName = pathParts.slice(2).join("/");

  return { bucketName, objectName };
}

async function signObjectURL({
  bucketName,
  objectName,
  method,
  ttlSec,
}: {
  bucketName: string;
  objectName: string;
  method: "GET" | "PUT" | "DELETE" | "HEAD";
  ttlSec: number;
}): Promise<string> {
  const request = {
    bucket_name: bucketName,
    object_name: objectName,
    method,
    expires_at: new Date(Date.now() + ttlSec * 1000).toISOString(),
  };
  const response = await fetch(
    `${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    }
  );
  if (!response.ok) {
    throw new Error(
      `Failed to sign object URL, errorcode: ${response.status}, ` +
        `make sure you're running on Replit`
    );
  }

  const { signed_url: signedURL } = await response.json();
  return signedURL;
}

export class ObjectStorageService {
  async uploadFile(options: UploadFileOptions): Promise<{ storagePath: string; size: number }> {
    const { fileName, fileContent, mimeType, accessLevel, customPath } = options;

    const directory = accessLevel === 'public' ? publicPaths[0] : privateDir;
    const storagePath = customPath || `${directory}/${Date.now()}-${fileName}`;

    // Parse the storage path to get bucket and object name
    const fullPath = `/${bucketId}/${storagePath}`;
    const { bucketName, objectName } = parseObjectPath(fullPath);

    const bucket = storageClient.bucket(bucketName);
    const file = bucket.file(objectName);

    await file.save(fileContent, {
      contentType: mimeType,
      metadata: {
        contentType: mimeType,
      },
    });

    return {
      storagePath,
      size: fileContent.length,
    };
  }

  async downloadFile(storagePath: string): Promise<Buffer> {
    const fullPath = `/${bucketId}/${storagePath}`;
    const { bucketName, objectName } = parseObjectPath(fullPath);

    const bucket = storageClient.bucket(bucketName);
    const file = bucket.file(objectName);

    const [exists] = await file.exists();
    if (!exists) {
      throw new Error('File not found or empty');
    }

    const [buffer] = await file.download();
    return buffer;
  }

  async deleteFile(storagePath: string): Promise<void> {
    const fullPath = `/${bucketId}/${storagePath}`;
    const { bucketName, objectName } = parseObjectPath(fullPath);

    const bucket = storageClient.bucket(bucketName);
    const file = bucket.file(objectName);

    await file.delete();
  }

  async getFileMetadata(storagePath: string): Promise<FileMetadata> {
    const fullPath = `/${bucketId}/${storagePath}`;
    const { bucketName, objectName } = parseObjectPath(fullPath);

    const bucket = storageClient.bucket(bucketName);
    const file = bucket.file(objectName);

    const [metadata] = await file.getMetadata();

    const size = typeof metadata.size === 'string' ? parseInt(metadata.size) : (metadata.size || 0);

    return {
      fileName: storagePath.split('/').pop() || storagePath,
      storagePath,
      size,
      mimeType: metadata.contentType,
      lastModified: metadata.updated ? new Date(metadata.updated) : undefined,
    };
  }

  async generateSignedUrl(storagePath: string, expiresIn: number = 3600): Promise<string> {
    const fullPath = `/${bucketId}/${storagePath}`;
    const { bucketName, objectName } = parseObjectPath(fullPath);

    return await signObjectURL({
      bucketName,
      objectName,
      method: "GET",
      ttlSec: expiresIn,
    });
  }

  async listFiles(prefix?: string): Promise<FileMetadata[]> {
    if (!bucketId) {
      throw new Error('DEFAULT_OBJECT_STORAGE_BUCKET_ID environment variable is not set');
    }

    const bucket = storageClient.bucket(bucketId);
    
    const [files] = await bucket.getFiles({
      prefix: prefix,
    });

    return files.map((file) => {
      const size = typeof file.metadata.size === 'string' 
        ? parseInt(file.metadata.size) 
        : (file.metadata.size || 0);

      return {
        fileName: file.name.split('/').pop() || file.name,
        storagePath: file.name,
        size,
        mimeType: file.metadata.contentType,
        lastModified: file.metadata.updated ? new Date(file.metadata.updated) : undefined,
      };
    });
  }

  async fileExists(storagePath: string): Promise<boolean> {
    try {
      const fullPath = `/${bucketId}/${storagePath}`;
      const { bucketName, objectName } = parseObjectPath(fullPath);

      const bucket = storageClient.bucket(bucketName);
      const file = bucket.file(objectName);

      const [exists] = await file.exists();
      return exists;
    } catch (error) {
      return false;
    }
  }
}

export const objectStorageService = new ObjectStorageService();
