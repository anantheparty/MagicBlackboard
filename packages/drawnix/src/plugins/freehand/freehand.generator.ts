import { Generator } from '@plait/common';
import { createG, createPath, PlaitBoard, setStrokeLinecap } from '@plait/core';
import { Options } from 'roughjs/bin/core';
import { Freehand } from './type';
import { gaussianSmooth, getFillByElement, getStrokeColorByElement } from './utils';
import { getStrokeWidthByElement } from '@plait/draw';
import { getFreehandInkSvgPath } from './ink/geometry';

export class FreehandGenerator extends Generator<Freehand> {
  protected draw(element: Freehand): SVGGElement | undefined {
    const strokeWidth = getStrokeWidthByElement(element);
    const strokeColor = getStrokeColorByElement(this.board, element);
    const fill = getFillByElement(this.board, element);
    const inkPath = getFreehandInkSvgPath(element);
    if (inkPath) {
      const g = createG();
      const path = createPath();
      path.setAttribute('d', inkPath);
      path.setAttribute('fill', strokeColor);
      path.setAttribute('fill-rule', 'nonzero');
      path.setAttribute('stroke', 'none');
      path.setAttribute('data-freehand-ink-version', `${element.ink?.version ?? ''}`);
      g.append(path);
      return g;
    }
    const option: Options = { strokeWidth, stroke: strokeColor, fill, fillStyle: 'solid' };
    const g = PlaitBoard.getRoughSVG(this.board).curve(
      gaussianSmooth(element.points, 1, 3),
      option
    );
    setStrokeLinecap(g, 'round');
    return g;
  }

  canDraw(_element: Freehand): boolean {
    return true;
  }
}
