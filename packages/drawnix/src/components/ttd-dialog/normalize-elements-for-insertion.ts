import type { PlaitElement } from '@plait/core';

type ElementRecord = PlaitElement & Record<string, unknown>;

export const normalizeTtdElementsForInsertion = (
  elements: readonly PlaitElement[]
): PlaitElement[] => {
  const normalizedElements = JSON.parse(JSON.stringify(elements)) as ElementRecord[];

  for (const element of normalizedElements) {
    if (element.type === 'mind' || element.type === 'mindmap') {
      delete element.isRoot;
    }
    if (
      (element.type === 'arrow-line' || element.type === 'line') &&
      Array.isArray(element.texts)
    ) {
      for (const text of element.texts) {
        if (typeof text === 'object' && text !== null) {
          delete (text as Record<string, unknown>).width;
          delete (text as Record<string, unknown>).height;
        }
      }
    }
  }

  return normalizedElements;
};
