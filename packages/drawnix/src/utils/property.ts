import { PlaitBoard, PlaitElement } from '@plait/core';
import { isClosedCustomGeometry, isClosedDrawElement, PlaitDrawElement } from '@plait/draw';
import { getFillByElement, getStrokeColorByElement, MindElement } from '@plait/mind';
import {
  getFillByElement as getFillByDrawElement,
  getStrokeColorByElement as getStrokeColorByDrawElement,
} from '@plait/draw';
import { getTextMarksByElement } from '@plait/text-plugins';

export const isClosedElement = (board: PlaitBoard, element: PlaitElement) => {
  if (PlaitDrawElement.isTable(element) || PlaitDrawElement.isSwimlane(element)) {
    return false;
  }
  return (
    MindElement.isMindElement(board, element) ||
    (PlaitDrawElement.isDrawElement(element) && isClosedDrawElement(element)) ||
    isClosedCustomGeometry(board, element)
  );
};

export const hasFillProperty = (board: PlaitBoard, element: PlaitElement) => {
  if (PlaitDrawElement.isTable(element) || PlaitDrawElement.isSwimlane(element)) {
    return false;
  }
  if (MindElement.isMindElement(board, element)) {
    return true;
  }
  if (isClosedCustomGeometry(board, element)) {
    return true;
  }
  if (PlaitDrawElement.isDrawElement(element)) {
    return (
      PlaitDrawElement.isShapeElement(element) &&
      !PlaitDrawElement.isImage(element) &&
      !PlaitDrawElement.isText(element) &&
      isClosedDrawElement(element)
    );
  }
  return false;
};

export const getCurrentFill = (board: PlaitBoard, element: PlaitElement) => {
  let currentFill: string | null = element.fill;
  if (!currentFill) {
    if (MindElement.isMindElement(board, element)) {
      currentFill = getFillByElement(board, element);
    }
    if (
      PlaitDrawElement.isDrawElement(element) ||
      PlaitDrawElement.isCustomGeometryElement(board, element)
    ) {
      currentFill = getFillByDrawElement(board, element);
    }
  }
  return currentFill as string;
};

export const getCurrentStrokeColor = (board: PlaitBoard, element: PlaitElement) => {
  let strokeColor: string | null = element.strokeColor;
  if (!strokeColor) {
    if (MindElement.isMindElement(board, element)) {
      strokeColor = getStrokeColorByElement(board, element);
    }
    if (
      PlaitDrawElement.isDrawElement(element) ||
      PlaitDrawElement.isCustomGeometryElement(board, element)
    ) {
      strokeColor = getStrokeColorByDrawElement(board, element);
    }
  }
  return strokeColor as string;
};

export const getCurrentFontColor = (board: PlaitBoard, element: PlaitElement) => {
  const marks = getTextMarksByElement(element);
  return marks.color;
};
