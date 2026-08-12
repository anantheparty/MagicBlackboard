import { MAX_ZOOM, MIN_ZOOM, PlaitBoard, ThemeColorMode, type Point } from '@plait/core';
import {
  MAX_DRAWNIX_FILE_ELEMENTS,
  MAX_DRAWNIX_FILE_BYTES,
  MAX_DRAWNIX_FILE_TREE_VALUES,
  MIME_TYPES,
  VERSIONS,
} from '../constants';
import { fileOpen, fileSave, type FileSystemHandle } from './filesystem';
import { DrawnixExportedData, DrawnixExportedType } from './types';
import { loadFromBlob, normalizeFile } from './blob';
import { MAX_ABSOLUTE_INK_COORDINATE } from '../plugins/freehand/ink/types';
import { areValidDrawnixElements } from './element-validator';

export type DrawnixFileHandle = FileSystemHandle | null;

export class DrawnixDocumentValidationError extends Error {
  constructor(message = 'The Drawnix document exceeds the supported schema or resource limits.') {
    super(message);
    this.name = 'DrawnixDocumentValidationError';
  }
}

type FileWithHandle = File & {
  handle?: FileSystemHandle;
};

export const getDefaultName = () => {
  const time = new Date().getTime();
  return time.toString();
};

export const saveAsJSON = async (board: PlaitBoard, name: string = getDefaultName()) => {
  return saveJSON(board, null, name);
};

export const saveJSON = async (
  board: PlaitBoard,
  existingFileHandle: DrawnixFileHandle = null,
  name: string = getDefaultName()
) => {
  const serialized = serializeAsJSON(board);
  const blob = new Blob([serialized], {
    type: MIME_TYPES.drawnix,
  });

  const fileHandle = await fileSave(blob, {
    name,
    extension: 'drawnix',
    description: 'Drawnix file',
    fileHandle: existingFileHandle,
  });
  return { fileHandle };
};

export const loadFromJSON = async (board: PlaitBoard) => {
  const file = await fileOpen({
    description: 'Drawnix files',
    // ToDo: Be over-permissive until https://bugs.webkit.org/show_bug.cgi?id=34442
    // gets resolved. Else, iOS users cannot open `.drawnix` files.
    // extensions: ["json", "drawnix", "png", "svg"],
  });
  const fileHandle = (file as FileWithHandle).handle || null;
  const data = await loadFromBlob(board, await normalizeFile(file));
  return { data, fileHandle };
};

const IMPORT_THEME_MODES = new Set<string>(Object.values(ThemeColorMode));

export const isValidDrawnixData = (data?: unknown): data is DrawnixExportedData => {
  return (
    isRecord(data) &&
    data.type === DrawnixExportedType.drawnix &&
    data.version === VERSIONS.drawnix &&
    data.source === 'web' &&
    Array.isArray(data.elements) &&
    data.elements.length <= MAX_DRAWNIX_FILE_ELEMENTS &&
    isSafeFiniteTree(data, new WeakSet(), 0, { remaining: MAX_DRAWNIX_FILE_TREE_VALUES }) &&
    areValidDrawnixElements(data.elements) &&
    isViewport(data.viewport) &&
    (data.theme === undefined || isTheme(data.theme))
  );
};

export const serializeAsJSON = (board: PlaitBoard): string => {
  const data = {
    type: DrawnixExportedType.drawnix,
    version: VERSIONS.drawnix,
    source: 'web',
    elements: board.children,
    viewport: board.viewport,
    theme: board.theme,
  };
  if (!isValidDrawnixData(data)) {
    throw new DrawnixDocumentValidationError();
  }
  const serialized = JSON.stringify(data, null, 2);
  if (new Blob([serialized]).size > MAX_DRAWNIX_FILE_BYTES) {
    throw new DrawnixDocumentValidationError('The Drawnix document exceeds the 32 MiB file limit.');
  }
  return serialized;
};

function isViewport(value: unknown): value is DrawnixExportedData['viewport'] {
  return (
    isRecord(value) &&
    Object.keys(value).every((key) => key === 'zoom' || key === 'origination') &&
    typeof value.zoom === 'number' &&
    Number.isFinite(value.zoom) &&
    value.zoom >= MIN_ZOOM &&
    value.zoom <= MAX_ZOOM &&
    (value.origination === undefined || isPoint(value.origination))
  );
}

function isTheme(value: unknown): value is NonNullable<DrawnixExportedData['theme']> {
  return (
    isRecord(value) &&
    Object.keys(value).length === 1 &&
    Object.prototype.hasOwnProperty.call(value, 'themeColorMode') &&
    typeof value.themeColorMode === 'string' &&
    IMPORT_THEME_MODES.has(value.themeColorMode)
  );
}

function isPoint(value: unknown): value is Point {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every(
      (coordinate) =>
        typeof coordinate === 'number' &&
        Number.isFinite(coordinate) &&
        Math.abs(coordinate) <= MAX_ABSOLUTE_INK_COORDINATE
    )
  );
}

function isSafeFiniteTree(
  value: unknown,
  ancestors: WeakSet<object>,
  depth: number,
  budget: { remaining: number }
): boolean {
  if (depth > 128 || budget.remaining <= 0) return false;
  budget.remaining -= 1;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || ancestors.has(value)) return false;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!(index in value)) return false;
    }
  } else if (!isRecord(value)) {
    return false;
  }
  ancestors.add(value);
  const entries = Array.isArray(value) ? value : Object.values(value);
  const safe = entries.every((entry) => isSafeFiniteTree(entry, ancestors, depth + 1, budget));
  ancestors.delete(value);
  return safe;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
