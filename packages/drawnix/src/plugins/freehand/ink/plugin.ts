import type { PlaitBoard, PlaitOptionsBoard, PlaitPlugin } from '@plait/core';
import { registerBoardDisposer } from '@plait-board/react-board';
import type { FreehandInkPluginOptions } from './types';

export const FREEHAND_INK_PLUGIN_KEY = 'drawnix.freehand-ink';

const DEFAULT_OPTIONS: FreehandInkPluginOptions = {
  getMode: () => 'legacy',
};

type LifecycleOwner = NonNullable<FreehandInkPluginOptions['onLifecycleRegistration']>;

type LifecycleRegistration = {
  readonly disposeSource: () => void;
  disposed: boolean;
  owner: symbol | null;
  ownerCallback: LifecycleOwner | null;
  unregisterBoardDisposer: (() => void) | null;
};

const BOARD_TO_LIFECYCLE_REGISTRATION = new WeakMap<PlaitBoard, LifecycleRegistration>();

export function getFreehandInkPluginOptions(board: PlaitBoard): FreehandInkPluginOptions {
  const options = (board as PlaitOptionsBoard).getPluginOptions<FreehandInkPluginOptions>(
    FREEHAND_INK_PLUGIN_KEY
  );
  return options ?? DEFAULT_OPTIONS;
}

export function buildFreehandInkPlugin(options: FreehandInkPluginOptions): PlaitPlugin {
  return (board) => {
    (board as PlaitOptionsBoard).setPluginOptions(FREEHAND_INK_PLUGIN_KEY, options);
    claimLifecycleRegistration(board, options);
    return board;
  };
}

/**
 * Bridges the built-in freehand plugin to options installed later by an
 * additional plugin. The owner receives an identity-bound disposer so an old
 * board session cannot remove a newer registration on the same board.
 */
export function registerFreehandInkLifecycleDisposer(
  board: PlaitBoard,
  disposeSource: () => void
): void {
  const previous = BOARD_TO_LIFECYCLE_REGISTRATION.get(board);
  if (previous) {
    disposeLifecycleRegistration(board, previous, false);
  }

  const registration: LifecycleRegistration = {
    disposeSource,
    disposed: false,
    owner: null,
    ownerCallback: null,
    unregisterBoardDisposer: null,
  };
  BOARD_TO_LIFECYCLE_REGISTRATION.set(board, registration);
  registration.unregisterBoardDisposer = registerBoardDisposer(board, () => {
    disposeLifecycleRegistration(board, registration, false);
  });
  claimLifecycleRegistration(board, getFreehandInkPluginOptions(board));
}

function claimLifecycleRegistration(board: PlaitBoard, options: FreehandInkPluginOptions): void {
  const registration = BOARD_TO_LIFECYCLE_REGISTRATION.get(board);
  const ownerCallback = options.onLifecycleRegistration;
  if (
    !registration ||
    registration.disposed ||
    !ownerCallback ||
    registration.ownerCallback === ownerCallback
  ) {
    return;
  }

  const owner = Symbol('freehand-ink-lifecycle-owner');
  registration.owner = owner;
  registration.ownerCallback = ownerCallback;
  try {
    ownerCallback(() => {
      if (registration.owner === owner) {
        disposeLifecycleRegistration(board, registration, true);
      }
    });
  } catch (error) {
    if (registration.owner === owner) {
      registration.owner = null;
      registration.ownerCallback = null;
    }
    throw error;
  }
}

function disposeLifecycleRegistration(
  board: PlaitBoard,
  registration: LifecycleRegistration,
  resetOwnedOptions: boolean
): void {
  if (registration.disposed) {
    return;
  }
  registration.disposed = true;
  const unregisterBoardDisposer = registration.unregisterBoardDisposer;
  registration.unregisterBoardDisposer = null;
  unregisterBoardDisposer?.();
  try {
    registration.disposeSource();
  } finally {
    if (BOARD_TO_LIFECYCLE_REGISTRATION.get(board) === registration) {
      BOARD_TO_LIFECYCLE_REGISTRATION.delete(board);
    }
    if (
      resetOwnedOptions &&
      registration.ownerCallback &&
      getFreehandInkPluginOptions(board).onLifecycleRegistration === registration.ownerCallback
    ) {
      (board as PlaitOptionsBoard).setPluginOptions(FREEHAND_INK_PLUGIN_KEY, DEFAULT_OPTIONS);
    }
    registration.owner = null;
    registration.ownerCallback = null;
  }
}
