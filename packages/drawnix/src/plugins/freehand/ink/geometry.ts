import {
  Point,
  RectangleClient,
  distanceBetweenPointAndSegment,
  isLineHitRectangle,
  rotatePoints,
} from '@plait/core';
import type { Freehand } from '../type';
import { isValidFreehandInkData } from './schema';
import { MAX_ABSOLUTE_INK_COORDINATE, type FreehandInkData } from './types';

export function isRenderableFreehandInk(
  element: Freehand
): element is Freehand & { ink: FreehandInkData } {
  if (!element.ink) {
    return false;
  }
  return (
    isValidFreehandInkData(element.ink, element.points.length) &&
    element.points.every(
      (point) =>
        Number.isFinite(point[0]) &&
        Number.isFinite(point[1]) &&
        Math.abs(point[0]) <= MAX_ABSOLUTE_INK_COORDINATE &&
        Math.abs(point[1]) <= MAX_ABSOLUTE_INK_COORDINATE
    ) &&
    hasCompatibleClosedInkEndpoints(element.points, element.ink.widths)
  );
}

export function getFreehandInkOutline(element: Freehand): readonly Point[] | null {
  const shapes = getFreehandInkShapes(element);
  return shapes ? shapes.flat() : null;
}

export function getFreehandInkShapes(element: Freehand): readonly (readonly Point[])[] | null {
  if (!isRenderableFreehandInk(element)) {
    return null;
  }
  return buildInkShapes(element.points, element.ink.widths);
}

function hasCompatibleClosedInkEndpoints(
  points: readonly Point[],
  widths: readonly number[]
): boolean {
  if (
    points.length < 3 ||
    points[0][0] !== points[points.length - 1][0] ||
    points[0][1] !== points[points.length - 1][1]
  ) {
    return true;
  }
  return widths[0] === widths[widths.length - 1];
}

export function getFreehandInkSvgPath(element: Freehand): string | null {
  const shapes = getFreehandInkShapes(element);
  return shapes ? shapes.map(inkOutlineToSvgPath).join(' ') : null;
}

export function buildInkShapes(
  points: readonly Point[],
  widths: readonly number[]
): readonly Point[][] {
  if (points.length === 0 || points.length !== widths.length) {
    return [];
  }
  const closed =
    points.length > 2 &&
    points[0][0] === points[points.length - 1][0] &&
    points[0][1] === points[points.length - 1][1];
  return closed
    ? buildClosedInkShapes(points.slice(0, -1), widths.slice(0, -1))
    : [buildInkOutline(points, widths)];
}

export function buildInkOutline(points: readonly Point[], widths: readonly number[]): Point[] {
  if (points.length === 0 || widths.length !== points.length) {
    return [];
  }
  if (points.length === 1) {
    return buildCircle(points[0], widths[0] / 2, 12);
  }

  const centerline = points;
  const centerlineWidths = widths;

  const left: Point[] = [];
  const right: Point[] = [];
  for (let index = 0; index < centerline.length; index += 1) {
    const previous = centerline[Math.max(0, index - 1)];
    const next = centerline[Math.min(centerline.length - 1, index + 1)];
    const tangentX = next[0] - previous[0];
    const tangentY = next[1] - previous[1];
    const magnitude = Math.hypot(tangentX, tangentY) || 1;
    const normalX = -tangentY / magnitude;
    const normalY = tangentX / magnitude;
    const radius = centerlineWidths[index] / 2;
    left.push([centerline[index][0] + normalX * radius, centerline[index][1] + normalY * radius]);
    right.push([centerline[index][0] - normalX * radius, centerline[index][1] - normalY * radius]);
  }

  const endTangent = normalizedTangent(
    centerline[centerline.length - 2],
    centerline[centerline.length - 1]
  );
  const startTangent = normalizedTangent(centerline[1], centerline[0]);
  const endCap = buildOutwardCap(
    centerline[centerline.length - 1],
    left[left.length - 1],
    endTangent,
    6
  );
  const startCap = buildOutwardCap(centerline[0], right[0], startTangent, 6);
  return [...left, ...endCap.slice(1), ...right.reverse(), ...startCap.slice(1)];
}

export function inkOutlineToSvgPath(outline: readonly Point[]): string {
  if (outline.length === 0) {
    return '';
  }
  const commands = outline.map(
    (point, index) => `${index === 0 ? 'M' : 'L'} ${format(point[0])} ${format(point[1])}`
  );
  return `${commands.join(' ')} Z`;
}

export function getFreehandRectangle(element: Freehand) {
  const rectangle = getPointBounds(element.points);
  if (!isRenderableFreehandInk(element)) {
    return rectangle;
  }
  let maximumWidth = 0;
  for (const width of element.ink.widths) {
    maximumWidth = Math.max(maximumWidth, width);
  }
  const radius = maximumWidth / 2;
  return {
    x: rectangle.x - radius,
    y: rectangle.y - radius,
    width: rectangle.width + radius * 2,
    height: rectangle.height + radius * 2,
  };
}

function getPointBounds(points: readonly Point[]) {
  if (points.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  let minimumX = points[0][0];
  let maximumX = points[0][0];
  let minimumY = points[0][1];
  let maximumY = points[0][1];
  for (let index = 1; index < points.length; index += 1) {
    minimumX = Math.min(minimumX, points[index][0]);
    maximumX = Math.max(maximumX, points[index][0]);
    minimumY = Math.min(minimumY, points[index][1]);
    maximumY = Math.max(maximumY, points[index][1]);
  }
  return {
    x: minimumX,
    y: minimumY,
    width: maximumX - minimumX,
    height: maximumY - minimumY,
  };
}

export function isPointHitFreehandInk(element: Freehand, point: Point, hitBuffer = 3): boolean {
  const shapes = getFreehandInkShapes(element);
  if (!shapes) {
    return false;
  }
  for (const shape of shapes) {
    if (isPointInNonzeroPolygon(point, shape)) {
      return true;
    }
    for (let index = 0; index < shape.length; index += 1) {
      const nextIndex = (index + 1) % shape.length;
      const distance = distanceBetweenPointAndSegment(
        point[0],
        point[1],
        shape[index][0],
        shape[index][1],
        shape[nextIndex][0],
        shape[nextIndex][1]
      );
      if (distance <= hitBuffer) {
        return true;
      }
    }
  }
  return false;
}

export function isRectangleHitFreehandInk(
  element: Freehand,
  rectangle: ReturnType<typeof RectangleClient.getRectangleByPoints>
): boolean {
  const shapes = getFreehandInkShapes(element);
  if (!shapes) {
    return false;
  }

  const center = RectangleClient.getCenterPoint(getPointBounds(element.points));
  return shapes.some((shape) => {
    const rotatedShape = element.angle
      ? (rotatePoints(shape as Point[], center, element.angle) as Point[])
      : (shape as Point[]);
    return (
      isLineHitRectangle(rotatedShape, rectangle) ||
      RectangleClient.getCornerPoints(rectangle).some((corner) =>
        isPointInNonzeroPolygon(corner, rotatedShape)
      )
    );
  });
}

/** Match SVG's default nonzero fill rule, including self-crossing outlines. */
function isPointInNonzeroPolygon(point: Point, polygon: readonly Point[]): boolean {
  let windingNumber = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index];
    const end = polygon[(index + 1) % polygon.length];
    if (start[1] <= point[1]) {
      if (end[1] > point[1] && signedSide(start, end, point) > 0) {
        windingNumber += 1;
      }
    } else if (end[1] <= point[1] && signedSide(start, end, point) < 0) {
      windingNumber -= 1;
    }
  }
  return windingNumber !== 0;
}

function signedSide(start: Point, end: Point, point: Point): number {
  return (end[0] - start[0]) * (point[1] - start[1]) - (point[0] - start[0]) * (end[1] - start[1]);
}

function buildClosedInkShapes(points: readonly Point[], widths: readonly number[]): Point[][] {
  if (points.length === 1) {
    return [buildCircle(points[0], widths[0] / 2, 12)];
  }
  const shapes: Point[][] = [];
  for (let index = 0; index < points.length; index += 1) {
    const nextIndex = (index + 1) % points.length;
    const start = points[index];
    const end = points[nextIndex];
    const tangent = normalizedTangent(start, end);
    if (start[0] !== end[0] || start[1] !== end[1]) {
      const normal: Point = [-tangent[1], tangent[0]];
      const startRadius = widths[index] / 2;
      const endRadius = widths[nextIndex] / 2;
      shapes.push([
        [start[0] + normal[0] * startRadius, start[1] + normal[1] * startRadius],
        [end[0] + normal[0] * endRadius, end[1] + normal[1] * endRadius],
        [end[0] - normal[0] * endRadius, end[1] - normal[1] * endRadius],
        [start[0] - normal[0] * startRadius, start[1] - normal[1] * startRadius],
      ]);
    }
    shapes.push(buildCircle(start, widths[index] / 2, 8));
  }
  return shapes;
}

function buildCircle(center: Point, radius: number, segments: number): Point[] {
  return Array.from({ length: segments }, (_, index) => {
    // Match the clockwise winding used by the closed-stroke segment quads.
    // SVG's nonzero fill rule then treats overlapping joins as a union rather
    // than cancelling opposite-winding subpaths into visual holes.
    const angle = -(index / segments) * Math.PI * 2;
    return [center[0] + Math.cos(angle) * radius, center[1] + Math.sin(angle) * radius];
  });
}

function buildOutwardCap(
  center: Point,
  start: Point,
  outwardTangent: Point,
  segments: number
): Point[] {
  const startAngle = Math.atan2(start[1] - center[1], start[0] - center[0]);
  const radius = Math.hypot(start[0] - center[0], start[1] - center[1]);
  const clockwiseMidAngle = startAngle - Math.PI / 2;
  const clockwiseDirection: Point = [Math.cos(clockwiseMidAngle), Math.sin(clockwiseMidAngle)];
  const clockwiseDot =
    clockwiseDirection[0] * outwardTangent[0] + clockwiseDirection[1] * outwardTangent[1];
  const direction = clockwiseDot >= 0 ? -1 : 1;
  return Array.from({ length: segments + 1 }, (_, index) => {
    const angle = startAngle + (direction * Math.PI * index) / segments;
    return [center[0] + Math.cos(angle) * radius, center[1] + Math.sin(angle) * radius];
  });
}

function normalizedTangent(start: Point, end: Point): Point {
  const x = end[0] - start[0];
  const y = end[1] - start[1];
  const magnitude = Math.hypot(x, y);
  if (magnitude === 0) {
    return [1, 0];
  }
  return [x / magnitude, y / magnitude];
}

function format(value: number): string {
  return (Math.round(value * 1000) / 1000).toString();
}
