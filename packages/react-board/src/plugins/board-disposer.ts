import type { PlaitBoard } from '@plait/core';

export type BoardDisposer = () => void;

type BoardDisposerRegistration = {
  readonly dispose: BoardDisposer;
  active: boolean;
};

const BOARD_TO_DISPOSERS = new WeakMap<PlaitBoard, Set<BoardDisposerRegistration>>();

/**
 * Registers cleanup owned by one board instance.
 *
 * The returned function only unregisters this exact entry. Resource owners
 * should call it after they dispose early so a later board teardown remains a
 * no-op for that resource.
 */
export function registerBoardDisposer(board: PlaitBoard, dispose: BoardDisposer): () => void {
  const registration: BoardDisposerRegistration = { dispose, active: true };
  const registrations = BOARD_TO_DISPOSERS.get(board) ?? new Set<BoardDisposerRegistration>();
  registrations.add(registration);
  BOARD_TO_DISPOSERS.set(board, registrations);

  return () => {
    if (!registration.active) {
      return;
    }
    registration.active = false;
    registrations.delete(registration);
    if (registrations.size === 0 && BOARD_TO_DISPOSERS.get(board) === registrations) {
      BOARD_TO_DISPOSERS.delete(board);
    }
  };
}

/**
 * Best-effort terminal cleanup for resources owned by a board instance.
 * Entries are detached before callbacks run so re-entrant or repeated teardown
 * cannot dispose the same registration twice.
 */
export function disposeBoardDisposers(board: PlaitBoard): void {
  const registrations = BOARD_TO_DISPOSERS.get(board);
  if (!registrations) {
    return;
  }

  BOARD_TO_DISPOSERS.delete(board);
  for (const registration of registrations) {
    if (!registration.active) {
      continue;
    }
    registration.active = false;
    try {
      registration.dispose();
    } catch {
      // One failing plugin must not prevent the remaining board resources from
      // being released during React unmount.
    }
  }
  registrations.clear();
}
