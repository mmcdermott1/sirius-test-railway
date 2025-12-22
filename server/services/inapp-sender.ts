import { createCommStorage, createCommInappStorage } from '../storage/comm';
import { notifyAlertCountChange } from '../modules/comm';
import type { Comm, CommInapp } from '@shared/schema';

export interface SendInappRequest {
  contactId: string;
  userId: string;
  title: string;
  body: string;
  linkUrl?: string;
  linkLabel?: string;
  initiatedBy?: string;
}

export interface SendInappResult {
  success: boolean;
  comm?: Comm;
  commInapp?: CommInapp;
  error?: string;
  errorCode?: 'VALIDATION_ERROR' | 'STORAGE_ERROR' | 'UNKNOWN_ERROR';
}

const commStorage = createCommStorage();
const commInappStorage = createCommInappStorage();

export async function sendInapp(request: SendInappRequest): Promise<SendInappResult> {
  const { contactId, userId, title, body, linkUrl, linkLabel, initiatedBy } = request;

  try {
    if (!contactId) {
      return {
        success: false,
        error: 'Contact ID is required',
        errorCode: 'VALIDATION_ERROR',
      };
    }

    if (!userId) {
      return {
        success: false,
        error: 'User ID is required for in-app messages',
        errorCode: 'VALIDATION_ERROR',
      };
    }

    if (!title || title.trim().length === 0) {
      return {
        success: false,
        error: 'Title is required',
        errorCode: 'VALIDATION_ERROR',
      };
    }

    if (!body || body.trim().length === 0) {
      return {
        success: false,
        error: 'Body is required',
        errorCode: 'VALIDATION_ERROR',
      };
    }

    if (title.length > 100) {
      return {
        success: false,
        error: 'Title must be 100 characters or less',
        errorCode: 'VALIDATION_ERROR',
      };
    }

    if (body.length > 500) {
      return {
        success: false,
        error: 'Body must be 500 characters or less',
        errorCode: 'VALIDATION_ERROR',
      };
    }

    const comm = await commStorage.createComm({
      medium: 'inapp',
      contactId,
      status: 'sent',
      sent: new Date(),
      data: { initiatedBy: initiatedBy || 'system' },
    });

    let commInappRecord: CommInapp;
    try {
      commInappRecord = await commInappStorage.createCommInapp({
        commId: comm.id,
        userId,
        title: title.trim(),
        body: body.trim(),
        linkUrl: linkUrl || null,
        linkLabel: linkLabel || null,
        status: 'pending',
      });
    } catch (inappError: any) {
      await commStorage.updateComm(comm.id, {
        status: 'failed',
        data: {
          ...comm.data as object,
          errorCode: 'STORAGE_ERROR',
          errorMessage: inappError?.message || 'Failed to create in-app message record',
        },
      });

      return {
        success: false,
        comm: { ...comm, status: 'failed' },
        error: inappError?.message || 'Failed to create in-app message record',
        errorCode: 'STORAGE_ERROR',
      };
    }

    setImmediate(() => notifyAlertCountChange(userId));

    return {
      success: true,
      comm,
      commInapp: commInappRecord,
    };

  } catch (error: any) {
    console.error('In-app message sending error:', error);
    return {
      success: false,
      error: error?.message || 'Unknown error occurred while sending in-app message',
      errorCode: 'UNKNOWN_ERROR',
    };
  }
}
