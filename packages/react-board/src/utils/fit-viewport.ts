import {
  BoardTransforms,
  PlaitBoard,
  clampZoomLevel,
  getRealScrollBarWidth,
  getRectangleByElements,
  getViewBoxCenterPoint,
  type Viewport,
} from '@plait/core';

const AUTO_FIT_PADDING = 16;

/** Calculates a fitted viewport without mutating the board. */
export const calculateFittedViewportWithinZoomBounds = (board: PlaitBoard): Viewport => {
  const scrollBarWidth = getRealScrollBarWidth(board);
  const boardContainerRect = PlaitBoard.getBoardContainer(board).getBoundingClientRect();
  const elementHostBox = getRectangleByElements(board, board.children, true);
  const viewportWidth = boardContainerRect.width - 2 * AUTO_FIT_PADDING;
  const viewportHeight = boardContainerRect.height - 2 * AUTO_FIT_PADDING;

  let requestedZoom = 1;
  if (viewportWidth < elementHostBox.width || viewportHeight < elementHostBox.height) {
    requestedZoom = Math.min(
      viewportWidth / elementHostBox.width,
      viewportHeight / elementHostBox.height
    );
  }
  const newZoom = clampZoomLevel(Number.isFinite(requestedZoom) ? requestedZoom : 1);
  const centerPoint = getViewBoxCenterPoint(board);
  const currentZoom = board.viewport.zoom;
  const newOrigination: [number, number] = [
    centerPoint[0] - boardContainerRect.width / 2 / newZoom + scrollBarWidth / 2 / currentZoom,
    centerPoint[1] - boardContainerRect.height / 2 / newZoom + scrollBarWidth / 2 / currentZoom,
  ];

  return { ...board.viewport, origination: newOrigination, zoom: newZoom };
};

/**
 * Fits the document with one valid viewport operation.
 *
 * Plait's built-in fit helper can emit a zoom below its own supported range
 * before callers have a chance to clamp it. Consumers that persist operations
 * would observe that transient invalid value, so calculate the bounded result
 * before applying it.
 */
export const fitViewportWithinZoomBounds = (board: PlaitBoard): void => {
  const fittedViewport = calculateFittedViewportWithinZoomBounds(board);
  BoardTransforms.updateViewport(board, fittedViewport.origination!, fittedViewport.zoom);
};
