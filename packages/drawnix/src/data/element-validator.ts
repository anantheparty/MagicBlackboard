import type { Point } from '@plait/core';
import {
  ArrowLineMarkerType,
  ArrowLineShape,
  BasicShapes,
  FlowchartSymbols,
  GEOMETRY_WITH_MULTIPLE_TEXT,
  GEOMETRY_WITHOUT_TEXT,
  SwimlaneSymbols,
  UMLSymbols,
  VectorLineShape,
} from '@plait/draw';
import {
  MAX_ABSOLUTE_INK_COORDINATE,
  MAX_FREEHAND_INK_SAMPLES,
  MAX_LEGACY_FREEHAND_POINTS,
} from '../plugins/freehand/ink/types';
import { isValidFreehandInkData } from '../plugins/freehand/ink/schema';
import { FreehandShape } from '../plugins/freehand/type';
import { MAX_DRAWNIX_FILE_ELEMENTS } from '../constants';

const MAX_ELEMENT_DEPTH = 128;
const TOP_LEVEL_TYPES = new Set([
  'geometry',
  'arrow-line',
  'line',
  'vector-line',
  'image',
  'table',
  'swimlane',
  'group',
  'mind',
  'mindmap',
  'freehand',
]);
const GEOMETRY_SHAPES = new Set<string>([
  ...Object.values(BasicShapes),
  ...Object.values(FlowchartSymbols),
  ...Object.values(UMLSymbols),
]);
const GEOMETRY_WITHOUT_TEXT_SHAPES = new Set<string>(GEOMETRY_WITHOUT_TEXT);
const GEOMETRY_WITH_MULTIPLE_TEXT_SHAPES = new Set<string>(GEOMETRY_WITH_MULTIPLE_TEXT);
const GEOMETRY_WITH_TABLE_DATA_SHAPES = new Set<string>([UMLSymbols.class, UMLSymbols.interface]);
const ARROW_LINE_SHAPES = new Set<string>(Object.values(ArrowLineShape));
const ARROW_LINE_MARKERS = new Set<string>(Object.values(ArrowLineMarkerType));
const VECTOR_LINE_SHAPES = new Set<string>(Object.values(VectorLineShape));
const SWIMLANE_SHAPES = new Set<string>(Object.values(SwimlaneSymbols));
const FREEHAND_SHAPES = new Set<string>(Object.values(FreehandShape));

export function areValidDrawnixElements(values: readonly unknown[]): boolean {
  const ids = new Set<string>();
  return (
    values.every((value) => isValidTopLevelElement(value, ids)) && haveValidGroupReferences(values)
  );
}

function haveValidGroupReferences(values: readonly unknown[]): boolean {
  const elements = new Map<string, Record<string, unknown>>();
  const pending = [...values];
  while (pending.length > 0) {
    const value = pending.pop();
    if (!isRecord(value) || typeof value.id !== 'string') {
      return false;
    }
    elements.set(value.id, value);
    if (
      (value.type === 'mind' || value.type === 'mindmap' || value.type === 'mind_child') &&
      Array.isArray(value.children)
    ) {
      pending.push(...value.children);
    }
  }

  for (const element of elements.values()) {
    if (typeof element.groupId !== 'string') {
      continue;
    }
    const group = elements.get(element.groupId);
    if (!group || group.type !== 'group' || group === element) {
      return false;
    }
  }

  const visited = new Set<string>();
  for (const element of elements.values()) {
    if (element.type !== 'group' || visited.has(element.id as string)) {
      continue;
    }
    const path: string[] = [];
    const pathIds = new Set<string>();
    let current: Record<string, unknown> | undefined = element;
    while (current) {
      const id = current.id as string;
      if (visited.has(id)) {
        break;
      }
      if (pathIds.has(id)) {
        return false;
      }
      path.push(id);
      pathIds.add(id);
      current = typeof current.groupId === 'string' ? elements.get(current.groupId) : undefined;
    }
    for (const id of path) {
      visited.add(id);
    }
  }
  return true;
}

function isValidTopLevelElement(value: unknown, ids: Set<string>): boolean {
  if (!registerIdentity(value, ids) || !TOP_LEVEL_TYPES.has(value.type)) {
    return false;
  }
  switch (value.type) {
    case 'geometry':
      return isValidGeometry(value);
    case 'arrow-line':
    case 'line':
      return isValidArrowLine(value);
    case 'vector-line':
      return isValidVectorLine(value);
    case 'image':
      return isValidImage(value);
    case 'table':
      return hasNoChildren(value) && isValidTableData(value);
    case 'swimlane':
      return (
        hasNoChildren(value) &&
        typeof value.shape === 'string' &&
        SWIMLANE_SHAPES.has(value.shape) &&
        (value.header === undefined || typeof value.header === 'boolean') &&
        isValidTableData(value)
      );
    case 'group':
      return hasNoChildren(value);
    case 'mind':
    case 'mindmap':
      return isValidMind(value, ids, true, 0);
    case 'freehand':
      return isValidFreehand(value);
    default:
      return false;
  }
}

function isValidFreehand(value: Record<string, unknown>): boolean {
  if (
    !hasNoChildren(value) ||
    typeof value.shape !== 'string' ||
    !FREEHAND_SHAPES.has(value.shape) ||
    !Array.isArray(value.points)
  ) {
    return false;
  }
  const hasAlignedV1Ink = isValidFreehandInkData(value.ink, value.points.length);
  return hasValidPoints(
    value,
    1,
    hasAlignedV1Ink ? MAX_FREEHAND_INK_SAMPLES : MAX_LEGACY_FREEHAND_POINTS
  );
}

function registerIdentity(
  value: unknown,
  ids: Set<string>
): value is Record<string, unknown> & { id: string; type: string } {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    value.id.trim().length === 0 ||
    ids.has(value.id) ||
    typeof value.type !== 'string' ||
    value.type.trim().length === 0 ||
    ids.size >= MAX_DRAWNIX_FILE_ELEMENTS ||
    (value.groupId !== undefined &&
      (typeof value.groupId !== 'string' || value.groupId.trim().length === 0))
  ) {
    return false;
  }
  ids.add(value.id);
  return true;
}

function isValidGeometry(value: Record<string, unknown>): boolean {
  if (
    !hasNoChildren(value) ||
    typeof value.shape !== 'string' ||
    !GEOMETRY_SHAPES.has(value.shape) ||
    !hasValidPoints(value, 2, 2)
  ) {
    return false;
  }
  if (GEOMETRY_WITH_TABLE_DATA_SHAPES.has(value.shape)) {
    return isValidTableData(value);
  }
  if (GEOMETRY_WITH_MULTIPLE_TEXT_SHAPES.has(value.shape)) {
    return isValidDrawTextArray(value.texts);
  }
  if (GEOMETRY_WITHOUT_TEXT_SHAPES.has(value.shape)) {
    return true;
  }
  return (
    isValidSlateElement(value.text) &&
    (value.shape !== BasicShapes.text || typeof value.autoSize === 'boolean')
  );
}

function isValidArrowLine(value: Record<string, unknown>): boolean {
  return (
    hasNoChildren(value) &&
    typeof value.shape === 'string' &&
    ARROW_LINE_SHAPES.has(value.shape) &&
    hasValidPoints(value, 2) &&
    isValidArrowHandle(value.source) &&
    isValidArrowHandle(value.target) &&
    Array.isArray(value.texts) &&
    value.texts.every(
      (text) =>
        isRecord(text) &&
        isValidSlateElement(text.text) &&
        typeof text.position === 'number' &&
        Number.isFinite(text.position) &&
        text.position >= 0 &&
        text.position <= 1
    )
  );
}

function isValidArrowHandle(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.marker === 'string' &&
    ARROW_LINE_MARKERS.has(value.marker) &&
    (value.boundId === undefined ||
      (typeof value.boundId === 'string' && value.boundId.trim().length > 0)) &&
    (value.connection === undefined || isPoint(value.connection))
  );
}

function isValidVectorLine(value: Record<string, unknown>): boolean {
  return (
    hasNoChildren(value) &&
    typeof value.shape === 'string' &&
    VECTOR_LINE_SHAPES.has(value.shape) &&
    hasValidPoints(value, 2)
  );
}

function isValidImage(value: Record<string, unknown>): boolean {
  return (
    hasNoChildren(value) &&
    hasValidPoints(value, 2, 2) &&
    typeof value.url === 'string' &&
    value.url.trim().length > 0
  );
}

function isValidTableData(value: Record<string, unknown>): boolean {
  if (
    !hasValidPoints(value, 2, 2) ||
    !Array.isArray(value.rows) ||
    value.rows.length === 0 ||
    !Array.isArray(value.columns) ||
    value.columns.length === 0 ||
    !Array.isArray(value.cells) ||
    value.cells.length === 0
  ) {
    return false;
  }
  const rowIds = readAxisIds(value.rows, 'height');
  const columnIds = readAxisIds(value.columns, 'width');
  if (!rowIds || !columnIds) return false;
  const cellIds = new Set<string>();
  const coordinates = new Set<string>();
  return value.cells.every((cell) => {
    if (
      !isRecord(cell) ||
      typeof cell.id !== 'string' ||
      cell.id.trim().length === 0 ||
      cellIds.has(cell.id) ||
      typeof cell.rowId !== 'string' ||
      !rowIds.has(cell.rowId) ||
      typeof cell.columnId !== 'string' ||
      !columnIds.has(cell.columnId) ||
      (cell.text !== undefined && !isValidSlateElement(cell.text)) ||
      !isOptionalPositiveInteger(cell.colspan) ||
      !isOptionalPositiveInteger(cell.rowspan)
    ) {
      return false;
    }
    const coordinate = `${cell.rowId}\u0000${cell.columnId}`;
    if (coordinates.has(coordinate)) return false;
    cellIds.add(cell.id);
    coordinates.add(coordinate);
    return true;
  });
}

function readAxisIds(values: readonly unknown[], sizeKey: 'height' | 'width') {
  const ids = new Set<string>();
  for (const value of values) {
    if (
      !isRecord(value) ||
      typeof value.id !== 'string' ||
      value.id.trim().length === 0 ||
      ids.has(value.id) ||
      (value[sizeKey] !== undefined &&
        (typeof value[sizeKey] !== 'number' ||
          !Number.isFinite(value[sizeKey]) ||
          value[sizeKey] <= 0))
    ) {
      return undefined;
    }
    ids.add(value.id);
  }
  return ids;
}

function isValidMind(
  value: Record<string, unknown>,
  ids: Set<string>,
  root: boolean,
  depth: number
): boolean {
  if (
    depth > MAX_ELEMENT_DEPTH ||
    (root ? !['mind', 'mindmap'].includes(value.type as string) : value.type !== 'mind_child') ||
    !isRecord(value.data) ||
    !isValidSlateElement(value.data.topic) ||
    !Array.isArray(value.children) ||
    (root && !hasValidPoints(value, 1)) ||
    (!root && value.points !== undefined && !hasValidPoints(value, 1)) ||
    !isValidMindData(value.data)
  ) {
    return false;
  }
  return value.children.every(
    (child) =>
      registerIdentity(child, ids) &&
      child.type === 'mind_child' &&
      isValidMind(child, ids, false, depth + 1)
  );
}

function isValidMindData(value: Record<string, unknown>): boolean {
  if (
    value.emojis !== undefined &&
    (!Array.isArray(value.emojis) ||
      !value.emojis.every(
        (emoji) => isRecord(emoji) && typeof emoji.name === 'string' && emoji.name.length > 0
      ))
  ) {
    return false;
  }
  if (value.image !== undefined) {
    return (
      isRecord(value.image) &&
      typeof value.image.url === 'string' &&
      value.image.url.trim().length > 0 &&
      typeof value.image.width === 'number' &&
      Number.isFinite(value.image.width) &&
      value.image.width > 0 &&
      typeof value.image.height === 'number' &&
      Number.isFinite(value.image.height) &&
      value.image.height > 0
    );
  }
  return true;
}

function isValidDrawTextArray(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (item) =>
        isRecord(item) &&
        typeof item.id === 'string' &&
        item.id.trim().length > 0 &&
        isValidSlateElement(item.text)
    )
  );
}

function isValidSlateElement(value: unknown, depth = 0): boolean {
  return (
    depth <= MAX_ELEMENT_DEPTH &&
    isRecord(value) &&
    Array.isArray(value.children) &&
    value.children.length > 0 &&
    value.children.every((child) => isValidSlateNode(child, depth + 1))
  );
}

function isValidSlateNode(value: unknown, depth: number): boolean {
  if (depth > MAX_ELEMENT_DEPTH || !isRecord(value)) return false;
  return typeof value.text === 'string'
    ? value.children === undefined
    : isValidSlateElement(value, depth);
}

function hasValidPoints(
  value: Record<string, unknown>,
  minimum: number,
  maximum = MAX_FREEHAND_INK_SAMPLES
): value is Record<string, unknown> & { points: Point[] } {
  return (
    Array.isArray(value.points) &&
    value.points.length >= minimum &&
    value.points.length <= maximum &&
    value.points.every(isPoint)
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

function isOptionalPositiveInteger(value: unknown): boolean {
  return value === undefined || (Number.isInteger(value) && (value as number) > 0);
}

function hasNoChildren(value: Record<string, unknown>): boolean {
  return value.children === undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
