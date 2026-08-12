import {
  BOARD_TO_ON_CHANGE,
  ListRender,
  PlaitElement,
  Viewport,
  createBoard,
  withBoard,
  withHandPointer,
  withHistory,
  withHotkey,
  withMoving,
  withOptions,
  withRelatedFragment,
  withSelection,
  PlaitBoard,
  type PlaitPlugin,
  type PlaitBoardOptions,
  type Selection,
  ThemeColorMode,
  BOARD_TO_AFTER_CHANGE,
  PlaitOperation,
  PlaitTheme,
  isFromScrolling,
  setIsFromScrolling,
  getSelectedElements,
  updateViewportOffset,
  initializeViewBox,
  withI18n,
  updateViewBox,
  FLUSHING,
} from '@plait/core';
import { fitViewportWithinZoomBounds } from './utils/fit-viewport';
import { BoardChangeData } from './plugins/board';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { withReact } from './plugins/with-react';
import { PlaitCommonElementRef, withImage, withText } from '@plait/common';
import { BoardContext, BoardContextValue } from './hooks/use-board';
import React from 'react';
import { withPinchZoom } from './plugins/with-pinch-zoom-plugin';
import { disposeBoardDisposers } from './plugins/board-disposer';

export type WrapperProps = {
  value: PlaitElement[];
  children: React.ReactNode;
  options: PlaitBoardOptions;
  plugins: PlaitPlugin[];
  viewport?: Viewport;
  theme?: PlaitTheme;
  onChange?: (data: BoardChangeData) => void;
  onSelectionChange?: (selection: Selection | null) => void;
  onValueChange?: (value: PlaitElement[]) => void;
  onViewportChange?: (value: Viewport) => void;
  onThemeChange?: (value: ThemeColorMode) => void;
};

export const Wrapper: React.FC<WrapperProps> = ({
  value,
  children,
  options,
  plugins,
  viewport,
  theme,
  onChange,
  onSelectionChange,
  onValueChange,
  onViewportChange,
  onThemeChange,
}) => {
  const [context, setContext] = useState<BoardContextValue | null>(null);
  useLayoutEffect(() => {
    const board = initializeBoard(value, options, plugins, viewport, theme);
    const listRender = initializeListRender(board);
    const nextContext: BoardContextValue = {
      v: 0,
      board,
      listRender,
    };
    setContext(nextContext);
    return () => {
      try {
        listRender.destroy();
      } finally {
        disposeBoardDisposers(board);
        setContext((current) => (current === nextContext ? null : current));
      }
    };
    // Board and plugin ownership is fixed for one mounted Wrapper. Changes to
    // these initialization props are handled by the existing update paths.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!context) {
    return null;
  }

  return (
    <InitializedWrapper
      context={context}
      value={value}
      theme={theme}
      onChange={onChange}
      onSelectionChange={onSelectionChange}
      onValueChange={onValueChange}
      onViewportChange={onViewportChange}
      onThemeChange={onThemeChange}
    >
      {children}
    </InitializedWrapper>
  );
};

type InitializedWrapperProps = Pick<
  WrapperProps,
  | 'value'
  | 'children'
  | 'theme'
  | 'onChange'
  | 'onSelectionChange'
  | 'onValueChange'
  | 'onViewportChange'
  | 'onThemeChange'
> & {
  context: BoardContextValue;
};

const InitializedWrapper: React.FC<InitializedWrapperProps> = ({
  context,
  value,
  children,
  theme,
  onChange,
  onSelectionChange,
  onValueChange,
  onViewportChange,
  onThemeChange,
}) => {
  const [contextVersion, setContextVersion] = useState(0);

  const { board, listRender } = context;

  const onContextChange = useCallback(() => {
    if (onChange) {
      const data: BoardChangeData = {
        children: board.children,
        operations: board.operations,
        viewport: board.viewport,
        selection: board.selection,
        theme: board.theme,
      };
      onChange(data);
    }

    const hasSelectionChanged = board.operations.some((o) =>
      PlaitOperation.isSetSelectionOperation(o)
    );
    const hasViewportChanged = board.operations.some((o) =>
      PlaitOperation.isSetViewportOperation(o)
    );
    const hasThemeChanged = board.operations.some((o) => PlaitOperation.isSetThemeOperation(o));
    const hasChildrenChanged =
      board.operations.length > 0 &&
      !board.operations.every(
        (o) =>
          PlaitOperation.isSetSelectionOperation(o) ||
          PlaitOperation.isSetViewportOperation(o) ||
          PlaitOperation.isSetThemeOperation(o)
      );

    if (onValueChange && hasChildrenChanged) {
      onValueChange(board.children);
    }

    if (onSelectionChange && hasSelectionChanged) {
      onSelectionChange(board.selection);
    }

    if (onViewportChange && hasViewportChanged) {
      onViewportChange(board.viewport);
    }

    if (onThemeChange && hasThemeChanged) {
      onThemeChange(board.theme.themeColorMode);
    }

    setContextVersion((version) => version + 1);
  }, [board, onChange, onSelectionChange, onThemeChange, onValueChange, onViewportChange]);

  useEffect(() => {
    BOARD_TO_ON_CHANGE.set(board, () => {
      const isOnlySetSelection =
        board.operations.length && board.operations.every((op) => op.type === 'set_selection');
      if (isOnlySetSelection) {
        listRender.update(board.children, {
          board: board,
          parent: board,
          parentG: PlaitBoard.getElementHost(board),
        });
        return;
      }
      const isSetViewport =
        board.operations.length && board.operations.some((op) => op.type === 'set_viewport');
      if (isSetViewport && isFromScrolling(board)) {
        setIsFromScrolling(board, false);
        listRender.update(board.children, {
          board: board,
          parent: board,
          parentG: PlaitBoard.getElementHost(board),
        });
        return;
      }
      listRender.update(board.children, {
        board: board,
        parent: board,
        parentG: PlaitBoard.getElementHost(board),
      });
      if (isSetViewport) {
        initializeViewBox(board);
      } else {
        updateViewBox(board);
      }
      updateViewportOffset(board);
      const selectedElements = getSelectedElements(board);
      selectedElements.forEach((element) => {
        const elementRef = PlaitElement.getElementRef<PlaitCommonElementRef>(element);
        elementRef.updateActiveSection();
      });
    });

    BOARD_TO_AFTER_CHANGE.set(board, () => {
      onContextChange();
    });

    return () => {
      BOARD_TO_ON_CHANGE.delete(board);
      BOARD_TO_AFTER_CHANGE.delete(board);
    };
  }, [board, listRender, onContextChange]);

  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    if (value !== board.children && !FLUSHING.get(board)) {
      board.children = value;
      if (theme) {
        board.theme = theme;
      }
      listRender.update(board.children, {
        board: board,
        parent: board,
        parentG: PlaitBoard.getElementHost(board),
      });
      fitViewportWithinZoomBounds(board);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <BoardContext.Provider value={{ ...context, v: context.v + contextVersion }}>
      {children}
    </BoardContext.Provider>
  );
};

const initializeBoard = (
  value: PlaitElement[],
  options: PlaitBoardOptions,
  plugins: PlaitPlugin[],
  viewport?: Viewport,
  theme?: PlaitTheme
) => {
  let board = withRelatedFragment(
    withHotkey(
      withHandPointer(
        withHistory(
          withSelection(
            withMoving(
              withBoard(
                withI18n(withOptions(withReact(withImage(withText(createBoard(value, options))))))
              )
            )
          )
        )
      )
    )
  );
  plugins.forEach((plugin: any) => {
    board = plugin(board);
  });

  withPinchZoom(board);

  if (viewport) {
    board.viewport = viewport;
  }

  if (theme) {
    board.theme = theme;
  }

  return board;
};

const initializeListRender = (board: PlaitBoard) => {
  const listRender = new ListRender(board);
  return listRender;
};
