import { GetObjectCommand, PutObjectCommand, DeleteObjectCommand, S3Client, ListObjectsV2Command, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
const publicPaths = process.env.PUBLIC_OBJECT_SEARCH_PATHS?.split(',') || ['public'];
const privateDir = process.env.PRIVATE_OBJECT_DIR || '.private';

if (!bucketId) {
  throw new Error('DEFAULT_OBJECT_STORAGE_BUCKET_ID environment variable is not set');
}

const s3Client = new S3Client({
  region: 'us-east-1',
  endpoint: 'https://storage.googleapis.com',
  credentials: {
    accessKeyId: 'replit',
    secretAccessKey: 'replit',
  },
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

export class ObjectStorageService {
  async uploadFile(options: UploadFileOptions): Promise<{ storagePath: string; size: number }> {
    const { fileName, fileContent, mimeType, accessLevel, customPath } = options;

    const directory = accessLevel === 'public' ? publicPaths[0] : privateDir;
    const storagePath = customPath || `${directory}/${Date.now()}-${fileName}`;

    const command = new PutObjectCommand({
      Bucket: bucketId,
      Key: storagePath,
      Body: fileContent,
      ContentType: mimeType,
    });

    await s3Client.send(command);

    return {
      storagePath,
      size: fileContent.length,
    };
  }

  async downloadFile(storagePath: string): Promise<Buffer> {
    const command = new GetObjectCommand({
      Bucket: bucketId,
      Key: storagePath,
    });

    const response = await s3Client.send(command);
    
    if (!response.Body) {
      throw new Error('File not found or empty');
    }

    const chunks: Uint8Array[] = [];
    for await (const chunk of response.Body as any) {
      chunks.push(chunk);
    }

    return Buffer.concat(chunks);
  }

  async deleteFile(storagePath: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: bucketId,
      Key: storagePath,
    });

    await s3Client.send(command);
  }

  async getFileMetadata(storagePath: string): Promise<FileMetadata> {
    const command = new HeadObjectCommand({
      Bucket: bucketId,
      Key: storagePath,
    });

    const response = await s3Client.send(command);

    return {
      fileName: storagePath.split('/').pop() || storagePath,
      storagePath,
      size: response.ContentLength || 0,
      mimeType: response.ContentType,
      lastModified: response.LastModified,
    };
  }

  async generateSignedUrl(storagePath: string, expiresIn: number = 3600): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: bucketId,
      Key: storagePath,
    });

    return await getSignedUrl(s3Client, command, { expiresIn });
  }

  async listFiles(prefix?: string): Promise<FileMetadata[]> {
    const command = new ListObjectsV2Command({
      Bucket: bucketId,
      Prefix: prefix,
    });

    const response = await s3Client.send(command);

    return (response.Contents || []).map((item: any) => ({
      fileName: item.Key?.split('/').pop() || item.Key || '',
      storagePath: item.Key || '',
      size: item.Size || 0,
      lastModified: item.LastModified,
    }));
  }

  async fileExists(storagePath: string): Promise<boolean> {
    try {
      await this.getFileMetadata(storagePath);
      return true;
    } catch (error) {
      return false;
    }
  }
}

export const objectStorageService = new ObjectStorageService();
