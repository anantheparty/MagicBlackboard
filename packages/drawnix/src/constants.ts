export enum EVENT {
  COPY = 'copy',
  PASTE = 'paste',
  CUT = 'cut',
  KEYDOWN = 'keydown',
  KEYUP = 'keyup',
  MOUSE_MOVE = 'mousemove',
  RESIZE = 'resize',
  UNLOAD = 'unload',
  FOCUS = 'focus',
  BLUR = 'blur',
  DRAG_OVER = 'dragover',
  DROP = 'drop',
  GESTURE_END = 'gestureend',
  BEFORE_UNLOAD = 'beforeunload',
  GESTURE_START = 'gesturestart',
  GESTURE_CHANGE = 'gesturechange',
  POINTER_MOVE = 'pointermove',
  POINTER_DOWN = 'pointerdown',
  POINTER_UP = 'pointerup',
  STATE_CHANGE = 'statechange',
  WHEEL = 'wheel',
  TOUCH_START = 'touchstart',
  TOUCH_END = 'touchend',
  HASHCHANGE = 'hashchange',
  VISIBILITY_CHANGE = 'visibilitychange',
  SCROLL = 'scroll',
  MENU_ITEM_SELECT = 'menu.itemSelect',
  MESSAGE = 'message',
  FULLSCREENCHANGE = 'fullscreenchange',
}

export const IMAGE_MIME_TYPES = {
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  avif: 'image/avif',
  jfif: 'image/jfif',
} as const;

export const MIME_TYPES = {
  json: 'application/json',
  drawnix: 'application/vnd.drawnix+json',
  // image
  ...IMAGE_MIME_TYPES,
} as const;

export const VERSIONS = {
  drawnix: 1,
} as const;

// Import is deliberately bounded before Blob.text()/JSON.parse() so a mistaken
// or hostile file cannot allocate an unbounded document in the browser.
export const MAX_DRAWNIX_FILE_BYTES = 32 * 1024 * 1024;
export const MAX_DRAWNIX_FILE_ELEMENTS = 5_000;
// This accommodates multiple creator-valid 20k-sample pressure strokes while
// remaining bounded well below what the 32 MiB byte gate could encode using
// adversarially terse JSON. Export uses the same validation before writing.
export const MAX_DRAWNIX_FILE_TREE_VALUES = 2_000_000;

// Images are embedded as base64 data URLs, which expands their source bytes by
// roughly one third before the board document is persisted. Keep the per-image
// source bound substantially below the whole-document import limit and reject
// it before FileReader or the browser image decoder allocates the payload.
export const MAX_EMBEDDED_IMAGE_FILE_BYTES = 8 * 1024 * 1024;
