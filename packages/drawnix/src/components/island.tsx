// Credits to excalidraw
import classNames from 'classnames';
import './island.scss';

import React from 'react';

type IslandStyle = React.CSSProperties;

type IslandProps = {
  children: React.ReactNode;
  padding?: number;
  className?: string | boolean;
  style?: IslandStyle;
} & React.HTMLAttributes<HTMLDivElement>;

export const Island = React.forwardRef<HTMLDivElement, IslandProps>(
  ({ children, padding, className, style, ...restProps }, ref) => (
    <div
      className={classNames('island', className)}
      style={{ '--padding': padding, ...style } as IslandStyle}
      ref={ref}
      {...restProps}
    >
      {children}
    </div>
  )
);
