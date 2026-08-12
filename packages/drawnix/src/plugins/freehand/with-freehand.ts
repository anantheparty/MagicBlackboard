import {
  PlaitBoard,
  PlaitElement,
  PlaitOptionsBoard,
  PlaitPluginElementContext,
  getSelectedElements,
  Selection,
} from '@plait/core';
import { Freehand, FREEHAND_TYPE } from './type';
import { FreehandComponent } from './freehand.component';
import { withFreehandCreate } from './with-freehand-create';
import { getFreehandRectangle, isHitFreehand, isRectangleHitFreehand } from './utils';
import { withFreehandFragment } from './with-freehand-fragment';
import { getHitDrawElement, WithDrawOptions, WithDrawPluginKey } from '@plait/draw';
import { withFreehandErase } from './with-freehand-erase';
import { isRenderableFreehandInk } from './ink/geometry';
import { isResizing } from '@plait/common';

export const withFreehand = (board: PlaitBoard) => {
  const { getRectangle, drawElement, isHit, isRectangleHit, getOneHitElement, isMovable, isAlign } =
    board;

  board.drawElement = (context: PlaitPluginElementContext) => {
    if (Freehand.isFreehand(context.element)) {
      return FreehandComponent;
    }
    return drawElement(context);
  };

  board.getRectangle = (element: PlaitElement) => {
    if (Freehand.isFreehand(element)) {
      return getFreehandRectangle(element);
    }
    return getRectangle(element);
  };

  board.isRectangleHit = (element: PlaitElement, selection: Selection) => {
    if (Freehand.isFreehand(element)) {
      return isRectangleHitFreehand(board, element, selection);
    }
    return isRectangleHit(element, selection);
  };

  board.isHit = (element, point, isStrict?: boolean) => {
    if (Freehand.isFreehand(element)) {
      return isHitFreehand(board, element, point);
    }
    return isHit(element, point, isStrict);
  };

  board.getOneHitElement = (elements, point) => {
    const isAllFreehand = elements.every((item) => Freehand.isFreehand(item));
    if (isAllFreehand) {
      return getHitDrawElement(board, elements as Freehand[], point);
    }
    return getOneHitElement(elements, point);
  };

  board.isMovable = (element) => {
    if (Freehand.isFreehand(element)) {
      return true;
    }
    return isMovable(element);
  };

  board.isAlign = (element) => {
    if (Freehand.isFreehand(element)) {
      return true;
    }
    return isAlign(element);
  };

  (board as PlaitOptionsBoard).setPluginOptions<WithDrawOptions>(WithDrawPluginKey, {
    customGeometryTypes: [FREEHAND_TYPE],
  });

  return withVariableInkResizeGuard(
    withFreehandErase(withFreehandFragment(withFreehandCreate(board)))
  );
};

const withVariableInkResizeGuard = (board: PlaitBoard): PlaitBoard => {
  const { apply } = board;
  let cachedResizeSelection: PlaitElement[] | undefined;
  let cachedResizeBlocked = false;
  board.apply = (operation) => {
    if (operation.type !== 'set_node' || !isResizing(board)) {
      cachedResizeSelection = undefined;
      apply(operation);
      return;
    }
    const selectedElements = getSelectedElements(board);
    if (selectedElements !== cachedResizeSelection) {
      cachedResizeSelection = selectedElements;
      cachedResizeBlocked = selectedElements.some(
        (element) => Freehand.isFreehand(element) && isRenderableFreehandInk(element)
      );
    }
    if (cachedResizeBlocked) {
      // V1 stores one circular scalar width per point, so anisotropic Plait
      // resize cannot be represented losslessly. Keep the whole selection
      // unchanged instead of silently distorting geometry or history.
      return;
    }
    apply(operation);
  };
  return board;
};
