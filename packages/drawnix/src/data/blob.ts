import { PlaitBoard } from '@plait/core';
import { isValidDrawnixData } from './json';
import {
  IMAGE_MIME_TYPES,
  MAX_DRAWNIX_FILE_BYTES,
  MAX_EMBEDDED_IMAGE_FILE_BYTES,
  MIME_TYPES,
} from '../constants';
import { ValueOf } from '../utils/utility-types';
import { DataURL } from '../types';

export const loadFromBlob = async (board: PlaitBoard, blob: Blob | File) => {
  if (blob.size > MAX_DRAWNIX_FILE_BYTES) {
    throw new Error('Error: invalid file');
  }
  const contents = await parseFileContents(blob);
  try {
    const data = JSON.parse(contents);
    if (isValidDrawnixData(data)) {
      return data;
    }
  } catch {}
  throw new Error('Error: invalid file');
};

export const createFile = (
  blob: File | Blob | ArrayBuffer,
  mimeType: ValueOf<typeof MIME_TYPES>,
  name: string | undefined
) => {
  return new File([blob], name || '', {
    type: mimeType,
  });
};

export const blobToArrayBuffer = (blob: Blob): Promise<ArrayBuffer> => {
  if ('arrayBuffer' in blob) {
    return blob.arrayBuffer();
  }
  // Safari
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      if (!event.target?.result) {
        return reject(new Error("Couldn't convert blob to ArrayBuffer"));
      }
      resolve(event.target.result as ArrayBuffer);
    };
    reader.readAsArrayBuffer(blob);
  });
};

export const normalizeFile = async (file: File): Promise<File> => {
  if (file.size > MAX_DRAWNIX_FILE_BYTES) {
    throw new Error('Error: invalid file');
  }
  if (!file.type) {
    if (file?.name?.endsWith('.drawnix')) {
      file = createFile(await blobToArrayBuffer(file), MIME_TYPES.drawnix, file.name);
    }
  }
  return file;
};

export const parseFileContents = async (blob: Blob | File): Promise<string> => {
  if (typeof blob.text === 'function') {
    return blob.text();
  }
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Error: invalid file'));
    reader.onabort = () => reject(new Error('Error: invalid file'));
    reader.onload = () =>
      typeof reader.result === 'string'
        ? resolve(reader.result)
        : reject(new Error('Error: invalid file'));
    reader.readAsText(blob, 'utf8');
  });
};

export class EmbeddedImageFileTooLargeError extends Error {
  constructor() {
    super('Error: image file is too large');
    this.name = 'EmbeddedImageFileTooLargeError';
  }
}

export const assertEmbeddedImageFileSize = (file: Blob | File): void => {
  if (file.size > MAX_EMBEDDED_IMAGE_FILE_BYTES) {
    throw new EmbeddedImageFileTooLargeError();
  }
};

export const getDataURL = async (file: Blob | File): Promise<DataURL> => {
  assertEmbeddedImageFileSize(file);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataURL = reader.result as DataURL;
      resolve(dataURL);
    };
    reader.onerror = (error) => reject(error);
    reader.readAsDataURL(file);
  });
};

export const isSupportedImageFileType = (type: string | null | undefined) => {
  return !!type && (Object.values(IMAGE_MIME_TYPES) as string[]).includes(type);
};

export const isSupportedImageFile = (
  blob: Blob | null | undefined
): blob is Blob & { type: ValueOf<typeof IMAGE_MIME_TYPES> } => {
  const { type } = blob || {};
  return isSupportedImageFileType(type);
};
