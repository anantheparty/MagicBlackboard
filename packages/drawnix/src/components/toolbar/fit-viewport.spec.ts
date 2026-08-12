import {
  calculateFittedViewportWithinZoomBounds as calculateFromReactBoard,
  fitViewportWithinZoomBounds as fitFromReactBoard,
} from '@plait-board/react-board';
import { describe, expect, it } from 'vitest';
import {
  calculateFittedViewportWithinZoomBounds,
  fitViewportWithinZoomBounds,
} from './fit-viewport';

describe('bounded viewport re-exports', () => {
  it('keeps Drawnix consumers on the shared react-board implementations', () => {
    expect(calculateFittedViewportWithinZoomBounds).toBe(calculateFromReactBoard);
    expect(fitViewportWithinZoomBounds).toBe(fitFromReactBoard);
  });
});
