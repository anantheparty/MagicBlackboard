import {
  BOARD_TO_SELECTED_ELEMENT,
  Transforms,
  setupTestingBoard,
  withBoard,
  withHistory,
  withOptions,
} from '@plait/core';
import { IS_RESIZING } from '@plait/common';
import { afterEach, describe, expect, it } from 'vitest';
import { FREEHAND_INK_SCHEMA_VERSION } from './ink/types';
import { FreehandShape, type Freehand } from './type';
import { withFreehand } from './with-freehand';

const fixtures: Array<ReturnType<typeof setupTestingBoard>> = [];

afterEach(() => {
  while (fixtures.length > 0) {
    fixtures.pop()?.destroy();
  }
});

function setup(element: Freehand) {
  const fixture = setupTestingBoard(
    [withOptions, withBoard, withHistory, withFreehand],
    [element],
    { selectedElements: [element], withElementHost: false, withHost: false }
  );
  fixtures.push(fixture);
  return fixture.board;
}

function setupMany(elements: Freehand[]) {
  const fixture = setupTestingBoard([withOptions, withBoard, withHistory, withFreehand], elements, {
    selectedElements: elements,
    withElementHost: false,
    withHost: false,
  });
  fixtures.push(fixture);
  return fixture.board;
}

function variableInk(): Freehand {
  return {
    id: 'variable-ink',
    type: 'freehand',
    shape: FreehandShape.feltTipPen,
    points: [
      [0, 0],
      [10, 10],
    ],
    strokeWidth: 4,
    ink: { version: FREEHAND_INK_SCHEMA_VERSION, widths: [2, 4] },
  };
}

describe('freehand ink resize integration', () => {
  it('keeps a variable-ink selection unchanged during unsupported anisotropic resize', () => {
    const board = setup(variableInk());
    IS_RESIZING.set(board, {} as never);
    try {
      Transforms.setNode(
        board,
        {
          points: [
            [0, 0],
            [20, 10],
          ],
        },
        [0]
      );
    } finally {
      IS_RESIZING.delete(board);
    }

    expect((board.children[0] as Freehand).ink?.widths).toEqual([2, 4]);
    expect((board.children[0] as Freehand).points).toEqual([
      [0, 0],
      [10, 10],
    ]);
    expect(board.history.undos).toEqual([]);
  });

  it('keeps legacy resize behavior available without adding ink', () => {
    const legacy = { ...variableInk(), ink: undefined };
    const board = setup(legacy);

    IS_RESIZING.set(board, {} as never);
    try {
      Transforms.setNode(
        board,
        {
          points: [
            [0, 0],
            [20, 20],
          ],
        },
        [0]
      );
    } finally {
      IS_RESIZING.delete(board);
    }

    expect((board.children[0] as Freehand).ink).toBeUndefined();
    expect((board.children[0] as Freehand).points).toEqual([
      [0, 0],
      [20, 20],
    ]);
  });

  it('keeps a mixed selection atomic when variable ink makes resize unsupported', () => {
    const variable = variableInk();
    const legacy = { ...variableInk(), id: 'legacy-peer', ink: undefined };
    const board = setupMany([variable, legacy]);

    IS_RESIZING.set(board, {} as never);
    try {
      Transforms.setNode(
        board,
        {
          points: [
            [0, 0],
            [20, 20],
          ],
        },
        [0]
      );
      Transforms.setNode(
        board,
        {
          points: [
            [20, 20],
            [40, 40],
          ],
        },
        [1]
      );
    } finally {
      IS_RESIZING.delete(board);
    }

    expect(board.children).toEqual([variable, legacy]);
    expect(board.history.undos).toEqual([]);
  });

  it('scans a stable mixed selection only once for a resize operation batch', () => {
    const variable = variableInk();
    const legacy = { ...variableInk(), id: 'legacy-peer', ink: undefined };
    const board = setupMany([variable, legacy]);
    const selected = [variable, legacy];
    let someCalls = 0;
    BOARD_TO_SELECTED_ELEMENT.set(
      board,
      new Proxy(selected, {
        get(target, property, receiver) {
          if (property === 'some') someCalls += 1;
          return Reflect.get(target, property, receiver);
        },
      })
    );

    IS_RESIZING.set(board, {} as never);
    try {
      Transforms.setNode(
        board,
        {
          points: [
            [0, 0],
            [20, 20],
          ],
        },
        [0]
      );
      Transforms.setNode(
        board,
        {
          points: [
            [20, 20],
            [40, 40],
          ],
        },
        [1]
      );
    } finally {
      IS_RESIZING.delete(board);
    }

    expect(someCalls).toBe(1);
    expect(board.children).toEqual([variable, legacy]);
  });

  it('allows rotation point updates without changing variable widths', () => {
    const board = setup(variableInk());

    Transforms.setNode(
      board,
      {
        points: [
          [-2.071, 5],
          [12.071, 5],
        ],
        angle: 45,
      },
      [0]
    );

    expect((board.children[0] as Freehand).ink?.widths).toEqual([2, 4]);
    board.undo();
    expect((board.children[0] as Freehand).ink?.widths).toEqual([2, 4]);
    board.redo();
    expect((board.children[0] as Freehand).ink?.widths).toEqual([2, 4]);
  });

  it('treats a closed endpoint-width mismatch consistently as legacy fallback', () => {
    const malformed = {
      ...variableInk(),
      points: [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0],
      ],
      ink: { version: FREEHAND_INK_SCHEMA_VERSION, widths: [2, 2, 2, 2, 4] },
    } as Freehand;
    const board = setup(malformed);

    expect(board.isHit(malformed, [0, 5])).toBe(true);
    IS_RESIZING.set(board, {} as never);
    try {
      Transforms.setNode(
        board,
        {
          points: [
            [0, 0],
            [20, 0],
            [20, 20],
            [0, 20],
            [0, 0],
          ],
        },
        [0]
      );
    } finally {
      IS_RESIZING.delete(board);
    }

    expect((board.children[0] as Freehand).points[1]).toEqual([20, 0]);
    expect(board.history.undos).toHaveLength(1);
  });
});
