import { BasicShapes, SwimlaneSymbols } from '@plait/draw';
import type { PlaitBoard, PlaitElement } from '@plait/core';
import { describe, expect, it } from 'vitest';
import { hasFillProperty, isClosedElement } from './property';

const board = {
  getPluginOptions: () => ({ customGeometryTypes: [] }),
} as unknown as PlaitBoard;

describe('generic fill eligibility', () => {
  const table = {
    id: 'table',
    type: 'table',
    points: [
      [0, 0],
      [100, 100],
    ],
  } as PlaitElement;
  const swimlane = {
    id: 'swimlane',
    type: 'swimlane',
    shape: SwimlaneSymbols.swimlaneHorizontal,
    points: [
      [0, 0],
      [100, 100],
    ],
  } as PlaitElement;
  const rectangle = {
    id: 'rectangle',
    type: 'geometry',
    shape: BasicShapes.rectangle,
    points: [
      [0, 0],
      [100, 100],
    ],
  } as PlaitElement;

  it.each([
    ['table', table],
    ['swimlane', swimlane],
  ])('excludes %s data from fill controls and transforms', (_name, element) => {
    expect(hasFillProperty(board, element)).toBe(false);
    expect(isClosedElement(board, element)).toBe(false);
  });

  it('keeps normal closed geometry fill-enabled', () => {
    expect(hasFillProperty(board, rectangle)).toBe(true);
    expect(isClosedElement(board, rectangle)).toBe(true);
  });
});
