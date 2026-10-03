import { browserAdapter } from "./browserAdapter.js";
import { type AnnotationOverlayStrings, annotationOverlayStrings } from "./i18n.js";
import type { AnnotationAction } from "./types.js";

const browser = browserAdapter;

export type AnnotationCommand = {
  action: AnnotationAction;
  selector?: string;
  comment?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  /** Saved annotations to re-anchor; set by the background for `restore` only. */
  saved?: unknown[];
  /**
   * True only when the command runs in the extension's isolated world, where the overlay can
   * report changes to the background through chrome.runtime. The debugger fallback runs in the
   * page's main world and must never try to message the extension from there.
   */
  persist?: boolean;
  /**
   * Overlay UI strings for the current display language. The background sets them;
   * manageAnnotationMode falls back to English when a caller does not.
   */
  ui?: AnnotationOverlayStrings;
};

type InjectedAnnotationCommand = AnnotationCommand & { ui: AnnotationOverlayStrings };

export type AnnotationRestoredBy = "selector" | "text" | "anchor" | "coordinates";

export type AnnotationRestoreReport = {
  status:
    | "restored"
    | "partial"
    | "none_restored"
    | "already_present"
    | "no_saved_annotations"
    | "url_mismatch";
  restored: {
    uid: string;
    displayNumber: number;
    savedDisplayNumber?: number;
    kind: string;
    comment: string;
    restoredBy: AnnotationRestoredBy;
  }[];
  unrestored: {
    uid: string;
    savedDisplayNumber?: number;
    kind: string;
    comment: string;
    selector?: string;
    text?: string;
    reason: string;
  }[];
  alreadyPresent: number;
  savedUrl?: string;
  currentUrl?: string;
};

export type AnnotationModeResult = {
  ok: true;
  enabled: boolean;
  count: number;
  annotations: unknown[];
  userMessage?: string;
  nextCommand?: string;
  /** Opaque overlay instance id; the background strips it before replying to the Gateway. */
  pageSessionId?: string;
  restore?: AnnotationRestoreReport;
  saved?: unknown;
};

function runAnnotationCommand(requestedCommand: InjectedAnnotationCommand): AnnotationModeResult {
  type Rect = { x: number; y: number; width: number; height: number };
  type ScrollAnchor =
    | { type: "window" }
    | { type: "frame"; selector: string }
    | { type: "element"; selector: string };
  type Annotation = {
    id: number;
    uid: string;
    displayNumber?: number;
    restoredBy?: AnnotationRestoredBy;
    restoredAt?: string;
    kind: "screenshot" | "dom" | "text";
    source: "drag" | "selection" | "cli";
    comment: string;
    selector?: string;
    text?: string;
    textAnchor?: {
      selector: string;
      index?: number;
      startPath?: number[];
      startOffset?: number;
      endPath?: number[];
      endOffset?: number;
      fragments?: Rect[];
    };
    rect: Rect;
    viewportRect: Rect;
    scroll: { x: number; y: number };
    anchor?: ScrollAnchor;
    createdAt: string;
    url: string;
    title: string;
    element?: {
      tag: string;
      selector: string;
      selectorQuality: "stable" | "structural";
      text: string;
      color?: string;
      backgroundColor?: string;
      fontSize?: string;
      fontFamily?: string;
    };
  };
  type AnnotationState = {
    enabled: boolean;
    mode: "area" | "text";
    nextId: number;
    selectedId: number | null;
    annotations: Annotation[];
    host: HTMLDivElement;
    shadow: ShadowRoot;
    capture: HTMLDivElement;
    layer: HTMLDivElement;
    toolbar: HTMLDivElement;
    draft: HTMLDivElement;
    editor: HTMLDivElement;
    dragStart: { x: number; y: number } | null;
    activeDraft: Rect | null;
    renderTimer: number | null;
    editGesture: {
      annotationId: number;
      mode: "move" | "resize";
      handle?: string;
      startX: number;
      startY: number;
      startRect: Rect;
      didMove: boolean;
    } | null;
    suppressClickId: number | null;
    lastSelectionSignature: string | null;
    pageSessionId: string;
    persist: boolean;
    // Optional so a state object created by an older overlay build stays valid.
    clearArmedUntil?: number;
    toastTimer?: number | null;
  };
  type WindowWithABGAnnotation = Window & { __abgAnnotationMode?: AnnotationState };

  const stateWindow = window as WindowWithABGAnnotation;
  const requestedAction = requestedCommand.action;
  // User-facing overlay strings. This function is serialized into the page and cannot import
  // the i18n module, so the background passes the resolved string table for the current UI
  // language with every command (see annotationOverlayStrings in i18n.ts).
  const strings = requestedCommand.ui;
  const fill = (raw: string, name: "count" | "number", value: number): string =>
    raw.split(`{${name}}`).join(String(value));
  const ui = {
    annotating: strings.annotating,
    modeGroup: strings.modeGroup,
    modeArea: strings.modeArea,
    modeText: strings.modeText,
    clear: strings.clear,
    clearConfirm: (count: number) => fill(strings.clearConfirm, "count", count),
    clearConfirmTitle: strings.clearConfirmTitle,
    done: strings.done,
    doneTitle: strings.doneTitle,
    count: (count: number) =>
      fill(count === 1 ? strings.countOne : strings.countOther, "count", count),
    hintArea: strings.hintArea,
    hintText: strings.hintText,
    hintSelected: strings.hintSelected,
    hintFinish: strings.hintFinish,
    annotationLabel: (displayNumber: number) =>
      fill(strings.annotationLabel, "number", displayNumber),
    editorTitle: (displayNumber: number) => fill(strings.annotationLabel, "number", displayNumber),
    editorPlaceholder: strings.editorPlaceholder,
    editorSave: strings.editorSave,
    editorDelete: strings.editorDelete,
    editorKeysPrimary: strings.editorKeysPrimary,
    editorKeysNewline: strings.editorKeysNewline,
    doneToast: (count: number) =>
      count === 0
        ? strings.doneToastNone
        : fill(count === 1 ? strings.doneToastOne : strings.doneToastOther, "count", count),
  };

  const stableSelectorAttrs = [
    "data-testid",
    "data-test",
    "data-cy",
    "data-qa",
    "name",
    "alt",
    "aria-label",
    "title",
  ];
  const meaningfulSelector = [
    "button",
    "a[href]",
    "input",
    "textarea",
    "select",
    "summary",
    "label",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "p",
    "li",
    "td",
    "th",
    "dt",
    "dd",
    "blockquote",
    "figcaption",
    "pre",
    "code",
    "img[alt]",
    "svg[aria-label]",
    "svg[role='img']",
    "[role='img']",
    "[role='button']",
    "[role='link']",
    "[role='menuitem']",
    "[role='tab']",
    "[role='checkbox']",
    "[contenteditable='true']",
  ].join(",");
  const cssEscape = (value: string): string => {
    const escaper = (globalThis as unknown as { CSS?: { escape?: (input: string) => string } }).CSS
      ?.escape;
    return escaper ? escaper(value) : value.replace(/["\\]/g, "\\$&");
  };
  const cssStringEscape = (value: string): string =>
    value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\a ");
  const isUniqueSelector = (selector: string): boolean => {
    try {
      return document.querySelectorAll(selector).length === 1;
    } catch {
      return false;
    }
  };
  const trimText = (value: string): string => value.replace(/\s+/g, " ").trim().slice(0, 180);
  const normalizeSelectionText = (value: string): string => value.replace(/\s+/g, " ").trim();
  type TextPoint = { node: Text; offset: number };
  type TextSelectionMatch = { rect: Rect; rects: Rect[]; index: number };
  const normalizedTextMapFor = (root: Element): { text: string; points: TextPoint[] } => {
    const textParts: string[] = [];
    const points: TextPoint[] = [];
    let pendingSpace: TextPoint | null = null;
    const pushPendingSpace = () => {
      if (!pendingSpace || textParts.length === 0) {
        pendingSpace = null;
        return;
      }
      if (textParts[textParts.length - 1] !== " ") {
        textParts.push(" ");
        points.push(pendingSpace);
      }
      pendingSpace = null;
    };
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const textNode = node as Text;
        const parent = textNode.parentElement;
        if (!parent || parent.closest("script, style, noscript")) {
          return NodeFilter.FILTER_REJECT;
        }
        return textNode.data.trim().length > 0
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      },
    });
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      for (let offset = 0; offset < node.data.length; offset += 1) {
        const char = node.data[offset] ?? "";
        if (/\s/.test(char)) {
          pendingSpace ??= { node, offset };
          continue;
        }
        pushPendingSpace();
        textParts.push(char);
        points.push({ node, offset });
      }
    }
    if (textParts[textParts.length - 1] === " ") {
      textParts.pop();
      points.pop();
    }
    return { text: textParts.join(""), points };
  };
  const rangeForTextMapSpan = (
    points: TextPoint[],
    startIndex: number,
    length: number,
  ): Range | null => {
    const start = points[startIndex];
    const end = points[startIndex + length - 1];
    if (!start || !end) return null;
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset + 1);
    return range;
  };
  const rectsForClientRects = (rects: DOMRect[]): Rect[] =>
    rects
      .map((rect) => {
        const left = Math.max(0, rect.left);
        const top = Math.max(0, rect.top);
        const right = Math.min(innerWidth, rect.right);
        const bottom = Math.min(innerHeight, rect.bottom);
        if (right <= left || bottom <= top) return null;
        return {
          x: Math.round(left),
          y: Math.round(top),
          width: Math.round(right - left),
          height: Math.round(bottom - top),
        };
      })
      .filter((rect): rect is Rect => rect !== null);
  const rangeRects = (range: Range): { rect: Rect; rects: Rect[] } | null => {
    const clientRects = Array.from(range.getClientRects());
    const fallbackClientRect = range.getBoundingClientRect();
    const rects = rectsForClientRects(clientRects.length > 0 ? clientRects : [fallbackClientRect]);
    const rect =
      boundingRectForClientRects(clientRects) ?? boundingRectForClientRects([fallbackClientRect]);
    return rect && rects.length > 0 ? { rect, rects } : null;
  };
  const nodePathFromRoot = (root: Node, node: Node): number[] | null => {
    const path: number[] = [];
    let current: Node | null = node;
    while (current && current !== root) {
      const parent: Node | null = current.parentNode;
      if (!parent) return null;
      const index = Array.prototype.indexOf.call(parent.childNodes, current);
      if (index < 0) return null;
      path.unshift(index);
      current = parent;
    }
    return current === root ? path : null;
  };
  const nodeFromPath = (root: Node, path: number[]): Node | null => {
    let current: Node | null = root;
    for (const index of path) {
      current = current?.childNodes[index] ?? null;
      if (!current) return null;
    }
    return current;
  };
  const rangeAnchorFor = (
    root: Element,
    range: Range,
    rect: Rect,
  ): NonNullable<Annotation["textAnchor"]> | null => {
    const startPath = nodePathFromRoot(root, range.startContainer);
    const endPath = nodePathFromRoot(root, range.endContainer);
    if (!startPath || !endPath) return null;
    const directRects = rangeRects(range)?.rects ?? [];
    return {
      selector: selectorInfoFor(root).selector,
      startPath,
      startOffset: range.startOffset,
      endPath,
      endOffset: range.endOffset,
      fragments: directRects.map((fragment) => ({
        x: Math.round(fragment.x - rect.x),
        y: Math.round(fragment.y - rect.y),
        width: fragment.width,
        height: fragment.height,
      })),
    };
  };
  const rangeForTextAnchor = (
    root: Element,
    anchor: NonNullable<Annotation["textAnchor"]>,
  ): Range | null => {
    if (
      !anchor.startPath ||
      !anchor.endPath ||
      typeof anchor.startOffset !== "number" ||
      typeof anchor.endOffset !== "number"
    ) {
      return null;
    }
    const startNode = nodeFromPath(root, anchor.startPath);
    const endNode = nodeFromPath(root, anchor.endPath);
    if (!startNode || !endNode) return null;
    try {
      const range = document.createRange();
      range.setStart(startNode, anchor.startOffset);
      range.setEnd(endNode, anchor.endOffset);
      return range;
    } catch {
      return null;
    }
  };
  const textSelectionRectsFor = (root: Element, text: string): TextSelectionMatch[] => {
    const needle = normalizeSelectionText(text);
    if (!needle) return [];
    const map = normalizedTextMapFor(root);
    const matches: TextSelectionMatch[] = [];
    let fromIndex = 0;
    while (matches.length < 30) {
      const index = map.text.indexOf(needle, fromIndex);
      if (index < 0) break;
      const range = rangeForTextMapSpan(map.points, index, needle.length);
      const rectInfo = range ? rangeRects(range) : null;
      if (rectInfo) matches.push({ ...rectInfo, index });
      fromIndex = index + Math.max(1, needle.length);
    }
    return matches;
  };
  const rectDistance = (a: Rect, b: Rect): number => {
    const ax = a.x + a.width / 2;
    const ay = a.y + a.height / 2;
    const bx = b.x + b.width / 2;
    const by = b.y + b.height / 2;
    return Math.hypot(ax - bx, ay - by);
  };
  const normalizeRect = (start: { x: number; y: number }, end: { x: number; y: number }) => {
    const x = Math.min(start.x, end.x);
    const y = Math.min(start.y, end.y);
    const width = Math.abs(end.x - start.x);
    const height = Math.abs(end.y - start.y);
    return { x, y, width, height };
  };
  const boundingRectForClientRects = (rects: DOMRect[]): Rect | null => {
    const visible = rects.filter((rect) => rect.width > 0 && rect.height > 0);
    if (visible.length === 0) return null;
    const left = Math.max(0, Math.min(...visible.map((rect) => rect.left)));
    const top = Math.max(0, Math.min(...visible.map((rect) => rect.top)));
    const right = Math.min(innerWidth, Math.max(...visible.map((rect) => rect.right)));
    const bottom = Math.min(innerHeight, Math.max(...visible.map((rect) => rect.bottom)));
    if (right <= left || bottom <= top) return null;
    return {
      x: Math.round(left),
      y: Math.round(top),
      width: Math.round(right - left),
      height: Math.round(bottom - top),
    };
  };
  const clampRect = (rect: Rect): Rect => ({
    x: Math.round(Math.max(0, rect.x)),
    y: Math.round(Math.max(0, rect.y)),
    width: Math.round(Math.max(16, rect.width)),
    height: Math.round(Math.max(16, rect.height)),
  });
  const resizedRect = (startRect: Rect, handle: string, dx: number, dy: number): Rect => {
    let left = startRect.x;
    let top = startRect.y;
    let right = startRect.x + startRect.width;
    let bottom = startRect.y + startRect.height;
    if (handle.includes("w")) left += dx;
    if (handle.includes("e")) right += dx;
    if (handle.includes("n")) top += dy;
    if (handle.includes("s")) bottom += dy;
    const minSize = 16;
    if (right - left < minSize) {
      if (handle.includes("w")) left = right - minSize;
      else right = left + minSize;
    }
    if (bottom - top < minSize) {
      if (handle.includes("n")) top = bottom - minSize;
      else bottom = top + minSize;
    }
    return clampRect({ x: left, y: top, width: right - left, height: bottom - top });
  };
  const viewportToPageRect = (rect: Rect): Rect => ({
    x: Math.round(rect.x + scrollX),
    y: Math.round(rect.y + scrollY),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  });
  const pageToViewportRect = (rect: Rect): Rect => ({
    x: Math.round(rect.x - scrollX),
    y: Math.round(rect.y - scrollY),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  });
  const selectorInfoFor = (el: Element): { selector: string; quality: "stable" | "structural" } => {
    if (el.id && document.querySelectorAll(`#${cssEscape(el.id)}`).length === 1) {
      return { selector: `#${cssEscape(el.id)}`, quality: "stable" };
    }
    for (const attr of stableSelectorAttrs) {
      const value = el.getAttribute(attr);
      if (!value) continue;
      const selector = `${el.tagName.toLowerCase()}[${attr}="${cssStringEscape(value)}"]`;
      if (isUniqueSelector(selector)) return { selector, quality: "stable" };
    }
    const classNames = Array.from(el.classList).filter(Boolean);
    if (classNames.length > 0) {
      const classSelector = `${el.tagName.toLowerCase()}.${classNames.map(cssEscape).join(".")}`;
      if (isUniqueSelector(classSelector)) {
        return { selector: classSelector, quality: "structural" };
      }
    }
    const parts: string[] = [];
    let current: Element | null = el;
    while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 6) {
      const parent: Element | null = current.parentElement;
      const tag = current.tagName.toLowerCase();
      if (!parent) {
        parts.unshift(tag);
        break;
      }
      const sameTagSiblings = Array.from(parent.children).filter(
        (child) => child instanceof Element && child.tagName === current?.tagName,
      );
      const nth = sameTagSiblings.indexOf(current) + 1;
      parts.unshift(sameTagSiblings.length > 1 ? `${tag}:nth-of-type(${nth})` : tag);
      current = parent;
    }
    return { selector: parts.join(" > "), quality: "structural" };
  };
  const isOverlayElement = (state: AnnotationState, element: Element): boolean =>
    element === state.host || state.host.contains(element) || state.shadow.contains(element);
  const elementAtViewportPoint = (
    state: AnnotationState,
    x: number,
    y: number,
  ): Element | undefined =>
    document.elementsFromPoint(x, y).find((el) => !isOverlayElement(state, el));
  type FrameElement = HTMLElement & { contentWindow?: Window | null };
  const isFrameElement = (element: Element): element is FrameElement => {
    const tag = element.tagName.toLowerCase();
    return tag === "frame" || tag === "iframe";
  };
  const frameWindowFor = (element: Element): Window | null => {
    if (!isFrameElement(element)) return null;
    try {
      const win = element.contentWindow ?? null;
      if (!win) return null;
      void win.scrollX;
      return win;
    } catch {
      return null;
    }
  };
  const isScrollableElement = (element: Element): element is HTMLElement => {
    if (!(element instanceof HTMLElement)) return false;
    if (element === document.body || element === document.documentElement) return false;
    const style = getComputedStyle(element);
    const overflow = `${style.overflow} ${style.overflowX} ${style.overflowY}`;
    if (!/(auto|scroll|overlay)/.test(overflow)) return false;
    return (
      element.scrollHeight > element.clientHeight + 1 ||
      element.scrollWidth > element.clientWidth + 1
    );
  };
  const anchorForViewportRect = (state: AnnotationState, viewportRect: Rect): ScrollAnchor => {
    const centerX = viewportRect.x + viewportRect.width / 2;
    const centerY = viewportRect.y + viewportRect.height / 2;
    const element = elementAtViewportPoint(state, centerX, centerY);
    if (!element) return { type: "window" };
    const frame = isFrameElement(element) ? element : element.closest("frame, iframe");
    if (frame && frameWindowFor(frame)) {
      return { type: "frame", selector: selectorInfoFor(frame).selector };
    }
    let current: Element | null = element;
    while (current && current !== document.documentElement) {
      if (isScrollableElement(current)) {
        return { type: "element", selector: selectorInfoFor(current).selector };
      }
      current = current.parentElement;
    }
    return { type: "window" };
  };
  const scrollForAnchor = (anchor?: ScrollAnchor): { x: number; y: number } => {
    if (anchor?.type === "frame") {
      const frame = document.querySelector(anchor.selector);
      const win = frame ? frameWindowFor(frame) : null;
      if (win) {
        return { x: Math.round(win.scrollX), y: Math.round(win.scrollY) };
      }
    }
    if (anchor?.type === "element") {
      const element = document.querySelector(anchor.selector);
      if (element instanceof HTMLElement) {
        return { x: Math.round(element.scrollLeft), y: Math.round(element.scrollTop) };
      }
    }
    return { x: Math.round(scrollX), y: Math.round(scrollY) };
  };
  const viewportToAnchoredRect = (
    state: AnnotationState,
    viewportRect: Rect,
  ): {
    rect: Rect;
    viewportRect: Rect;
    scroll: { x: number; y: number };
    anchor: ScrollAnchor;
  } => {
    const clamped = clampRect(viewportRect);
    const anchor = anchorForViewportRect(state, clamped);
    if (anchor.type === "frame") {
      const frame = document.querySelector(anchor.selector);
      const win = frame ? frameWindowFor(frame) : null;
      if (frame && win) {
        const frameRect = frame.getBoundingClientRect();
        const scroll = { x: Math.round(win.scrollX), y: Math.round(win.scrollY) };
        return {
          anchor,
          scroll,
          viewportRect: clamped,
          rect: {
            x: Math.round(clamped.x - frameRect.left + scroll.x),
            y: Math.round(clamped.y - frameRect.top + scroll.y),
            width: clamped.width,
            height: clamped.height,
          },
        };
      }
    }
    if (anchor.type === "element") {
      const element = document.querySelector(anchor.selector);
      if (element instanceof HTMLElement) {
        const elementRect = element.getBoundingClientRect();
        const scroll = { x: Math.round(element.scrollLeft), y: Math.round(element.scrollTop) };
        return {
          anchor,
          scroll,
          viewportRect: clamped,
          rect: {
            x: Math.round(clamped.x - elementRect.left + scroll.x),
            y: Math.round(clamped.y - elementRect.top + scroll.y),
            width: clamped.width,
            height: clamped.height,
          },
        };
      }
    }
    return {
      anchor: { type: "window" },
      scroll: { x: Math.round(scrollX), y: Math.round(scrollY) },
      viewportRect: clamped,
      rect: viewportToPageRect(clamped),
    };
  };
  const storedAnnotationRectToViewport = (annotation: Annotation): Rect => {
    if (annotation.anchor?.type === "frame") {
      const frame = document.querySelector(annotation.anchor.selector);
      const win = frame ? frameWindowFor(frame) : null;
      if (frame && win) {
        const frameRect = frame.getBoundingClientRect();
        return {
          x: Math.round(annotation.rect.x + frameRect.left - win.scrollX),
          y: Math.round(annotation.rect.y + frameRect.top - win.scrollY),
          width: Math.round(annotation.rect.width),
          height: Math.round(annotation.rect.height),
        };
      }
    }
    if (annotation.anchor?.type === "element") {
      const element = document.querySelector(annotation.anchor.selector);
      if (element instanceof HTMLElement) {
        const elementRect = element.getBoundingClientRect();
        return {
          x: Math.round(annotation.rect.x + elementRect.left - element.scrollLeft),
          y: Math.round(annotation.rect.y + elementRect.top - element.scrollTop),
          width: Math.round(annotation.rect.width),
          height: Math.round(annotation.rect.height),
        };
      }
    }
    return pageToViewportRect(annotation.rect);
  };
  const textSelectionMatchForAnnotation = (
    annotation: Annotation,
    fallbackRect: Rect,
  ): TextSelectionMatch | null => {
    if (annotation.kind !== "text" || !annotation.text || !annotation.textAnchor) return null;
    const root = document.querySelector(annotation.textAnchor.selector);
    if (!root) return null;
    const directRange = rangeForTextAnchor(root, annotation.textAnchor);
    const directRects = directRange ? rangeRects(directRange) : null;
    if (directRects) return { ...directRects, index: annotation.textAnchor.index ?? -1 };
    const matches = textSelectionRectsFor(root, annotation.text);
    if (matches.length === 0) return null;
    if (typeof annotation.textAnchor.index === "number") {
      const indexedMatch = matches.find((match) => match.index === annotation.textAnchor?.index);
      if (indexedMatch) return indexedMatch;
    }
    return matches.reduce((best, candidate) =>
      rectDistance(candidate.rect, fallbackRect) < rectDistance(best.rect, fallbackRect)
        ? candidate
        : best,
    );
  };
  const rectForTextAnnotation = (annotation: Annotation, fallbackRect: Rect): Rect | null => {
    return textSelectionMatchForAnnotation(annotation, fallbackRect)?.rect ?? null;
  };
  const highlightRectsForTextAnnotation = (
    annotation: Annotation,
    fallbackRect: Rect,
  ): Rect[] | null => {
    const matchedRects = textSelectionMatchForAnnotation(annotation, fallbackRect)?.rects;
    if (matchedRects) return matchedRects;
    const fragments = annotation.textAnchor?.fragments;
    if (!fragments || fragments.length === 0) return null;
    return fragments.map((fragment) => ({
      x: Math.round(fallbackRect.x + fragment.x),
      y: Math.round(fallbackRect.y + fragment.y),
      width: fragment.width,
      height: fragment.height,
    }));
  };
  const anchoredToViewportRect = (annotation: Annotation): Rect => {
    const fallbackRect = storedAnnotationRectToViewport(annotation);
    const textRect = rectForTextAnnotation(annotation, fallbackRect);
    if (textRect) return textRect;
    if (annotation.kind === "dom" && annotation.selector) {
      const element = document.querySelector(annotation.selector);
      if (element) {
        try {
          return rectForElement(element);
        } catch {
          // Fall back to the stored visual rectangle if the DOM target is temporarily hidden.
        }
      }
    }
    return fallbackRect;
  };
  const isAlwaysScreenshotElement = (element: Element): boolean => {
    const tag = element.tagName.toLowerCase();
    return tag === "canvas" || tag === "video";
  };
  const isMediaElement = (element: Element): boolean => {
    const tag = element.tagName.toLowerCase();
    return tag === "svg" || tag === "img";
  };
  const isLikelyLayoutWrapper = (element: Element): boolean => {
    const tag = element.tagName.toLowerCase();
    if (
      ["html", "body", "main", "section", "article", "nav", "aside", "header", "footer"].includes(
        tag,
      )
    ) {
      return true;
    }
    const role = element.getAttribute("role")?.toLowerCase();
    if (role && ["main", "region", "presentation", "none", "group"].includes(role)) return true;
    const textLength = trimText(
      (element as HTMLElement).innerText || element.textContent || "",
    ).length;
    return element.children.length >= 3 && textLength > 240;
  };
  const nearestMeaningfulElement = (state: AnnotationState, start: Element): Element | null => {
    let stableFallback: Element | null = null;
    let current: Element | null = start;
    while (current && current !== document.documentElement) {
      if (isOverlayElement(state, current)) return null;
      if (current.matches(meaningfulSelector)) return current;
      if (!stableFallback) {
        const info = selectorInfoFor(current);
        if (info.quality === "stable") stableFallback = current;
      }
      current = current.parentElement;
    }
    return stableFallback;
  };
  const meaningfulDescendantAtPoint = (
    state: AnnotationState,
    root: Element,
    x: number,
    y: number,
  ): Element | null => {
    const candidates = Array.from(root.querySelectorAll(meaningfulSelector))
      .filter((candidate) => !isOverlayElement(state, candidate))
      .map((candidate) => {
        const rect = candidate.getBoundingClientRect();
        return { candidate, rect };
      })
      .filter(({ candidate, rect }) => {
        if (rect.width < 1 || rect.height < 1) return false;
        if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return false;
        return !isLikelyLayoutWrapper(candidate);
      })
      .sort((lhs, rhs) => lhs.rect.width * lhs.rect.height - rhs.rect.width * rhs.rect.height);
    return candidates[0]?.candidate ?? null;
  };
  const metadataForElement = (element: Element): NonNullable<Annotation["element"]> => {
    const html = element as HTMLElement;
    const style = getComputedStyle(element);
    const selectorInfo = selectorInfoFor(element);
    return {
      tag: element.tagName.toLowerCase(),
      selector: selectorInfo.selector,
      selectorQuality: selectorInfo.quality,
      text: trimText(
        element.getAttribute("aria-label") ||
          element.getAttribute("title") ||
          html.innerText ||
          element.textContent ||
          "",
      ),
      color: style.color,
      backgroundColor: style.backgroundColor,
      fontSize: style.fontSize,
      fontFamily: style.fontFamily,
    };
  };
  const metadataForTextSelection = (
    element: Element,
    text: string,
  ): NonNullable<Annotation["element"]> => ({
    ...metadataForElement(element),
    text: trimText(text),
  });
  const elementFromRangeContainer = (container: Node): Element | null => {
    if (container instanceof Element) return container;
    const parent = container.parentElement;
    return parent ?? null;
  };
  const selectionRootElement = (state: AnnotationState, range: Range): Element | null => {
    const common = elementFromRangeContainer(range.commonAncestorContainer);
    if (common && !isOverlayElement(state, common)) return common;
    const start = elementFromRangeContainer(range.startContainer);
    const end = elementFromRangeContainer(range.endContainer);
    for (const candidate of [start, end]) {
      if (candidate && !isOverlayElement(state, candidate)) return candidate;
    }
    return null;
  };
  const selectionAnnotationTarget = (
    state: AnnotationState,
  ): {
    rect: Rect;
    text: string;
    element?: NonNullable<Annotation["element"]>;
    textAnchor: NonNullable<Annotation["textAnchor"]>;
    signature: string;
  } | null => {
    const selectedRange = getSelection();
    if (!selectedRange || selectedRange.isCollapsed || selectedRange.rangeCount === 0) return null;
    const text = selectedRange.toString().trim();
    if (!text) return null;
    const range = selectedRange.getRangeAt(0);
    const common = elementFromRangeContainer(range.commonAncestorContainer);
    if (common && isOverlayElement(state, common)) return null;
    const root = selectionRootElement(state, range);
    if (!root) return null;
    const rectInfo = rangeRects(range);
    const rect = rectInfo?.rect;
    if (!rect || rect.width < 2 || rect.height < 2) return null;
    const element = metadataForTextSelection(root, text);
    const match = textSelectionRectsFor(root, text).reduce<TextSelectionMatch | null>(
      (best, candidate) =>
        !best || rectDistance(candidate.rect, rect) < rectDistance(best.rect, rect)
          ? candidate
          : best,
      null,
    );
    const textAnchor = rangeAnchorFor(root, range, rect) ?? {
      selector: selectorInfoFor(root).selector,
    };
    textAnchor.index = match?.index;
    const signature = `${textAnchor.selector}:${text.slice(0, 120)}:${rect.x}:${rect.y}:${rect.width}:${rect.height}`;
    return { rect, text, element, textAnchor, signature };
  };
  const elementAtCenter = (state: AnnotationState, rect: Rect): Annotation["element"] => {
    const x = rect.x + rect.width / 2;
    const y = rect.y + rect.height / 2;
    const element = elementAtViewportPoint(state, x, y);
    const meaningfulElement = element ? nearestMeaningfulElement(state, element) : null;
    return meaningfulElement ? metadataForElement(meaningfulElement) : undefined;
  };
  const rectForElement = (element: Element): Rect => {
    const rect = element.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) {
      throw new Error("selector matched an element without a visible box");
    }
    return {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
  };
  const rectArea = (rect: Rect): number => rect.width * rect.height;
  const overlapArea = (a: Rect, b: Rect): number => {
    const left = Math.max(a.x, b.x);
    const top = Math.max(a.y, b.y);
    const right = Math.min(a.x + a.width, b.x + b.width);
    const bottom = Math.min(a.y + a.height, b.y + b.height);
    return Math.max(0, right - left) * Math.max(0, bottom - top);
  };
  const inferDomTarget = (
    state: AnnotationState,
    viewportRect: Rect,
  ): { rect: Rect; selector: string; element: NonNullable<Annotation["element"]> } | null => {
    const pointMode = viewportRect.width < 8 || viewportRect.height < 8;
    const centerX = viewportRect.x + viewportRect.width / 2;
    const centerY = viewportRect.y + viewportRect.height / 2;
    const element = elementAtViewportPoint(state, centerX, centerY);
    if (!element) return null;
    const initialMeaningfulElement = nearestMeaningfulElement(state, element);
    const meaningfulElement =
      initialMeaningfulElement &&
      isLikelyLayoutWrapper(initialMeaningfulElement) &&
      rectArea(rectForElement(initialMeaningfulElement)) / Math.max(1, innerWidth * innerHeight) >
        0.25
        ? (meaningfulDescendantAtPoint(state, initialMeaningfulElement, centerX, centerY) ??
          initialMeaningfulElement)
        : (meaningfulDescendantAtPoint(state, element, centerX, centerY) ??
          initialMeaningfulElement);
    if (!meaningfulElement || isAlwaysScreenshotElement(meaningfulElement)) return null;

    const candidateRect = rectForElement(meaningfulElement);
    const viewportArea = Math.max(1, innerWidth * innerHeight);
    if (rectArea(candidateRect) / viewportArea > 0.7 && !pointMode) return null;
    if (isLikelyLayoutWrapper(meaningfulElement)) {
      const selectedArea = Math.max(1, rectArea(viewportRect));
      const candidateArea = Math.max(1, rectArea(candidateRect));
      if (pointMode && candidateArea / viewportArea > 0.35) return null;
      if (
        !pointMode &&
        (candidateArea / selectedArea > 1.6 || candidateArea / viewportArea > 0.55)
      ) {
        return null;
      }
    }
    if (!pointMode) {
      const selectedArea = Math.max(1, rectArea(viewportRect));
      const covered = overlapArea(viewportRect, candidateRect) / selectedArea;
      const sizeRatio =
        Math.min(rectArea(viewportRect), rectArea(candidateRect)) /
        Math.max(rectArea(viewportRect), rectArea(candidateRect), 1);
      if (covered < 0.8 || sizeRatio < 0.35) return null;
    }

    const elementMetadata = metadataForElement(meaningfulElement);
    if (isMediaElement(meaningfulElement) && elementMetadata.selectorQuality !== "stable") {
      return null;
    }
    if (
      elementMetadata.selectorQuality !== "stable" &&
      !meaningfulElement.matches(meaningfulSelector)
    ) {
      return null;
    }
    return {
      rect: candidateRect,
      selector: elementMetadata.selector,
      element: elementMetadata,
    };
  };
  const snapshotAnnotations = (state: AnnotationState): Annotation[] =>
    state.annotations.map((annotation, index) => ({
      ...annotation,
      displayNumber: index + 1,
      viewportRect: anchoredToViewportRect(annotation),
      scroll: scrollForAnchor(annotation.anchor),
      url: location.href,
      title: document.title,
    }));
  const makeUid = (): string => {
    const cryptoApi = (globalThis as unknown as { crypto?: { randomUUID?: () => string } }).crypto;
    try {
      if (typeof cryptoApi?.randomUUID === "function") return cryptoApi.randomUUID();
    } catch {
      // randomUUID is unavailable on some insecure origins; fall through.
    }
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  };
  // Reports the annotation list to the background so it survives a reload. The background
  // keeps it in chrome.storage.session, which page scripts and content scripts cannot read.
  // Nothing is written to page-visible storage.
  const reportAnnotationsChanged = (state: AnnotationState, cleared = false) => {
    if (!state.persist) return;
    const runtime = (
      globalThis as unknown as {
        chrome?: { runtime?: { id?: string; sendMessage?: (message: unknown) => unknown } };
      }
    ).chrome?.runtime;
    if (!runtime?.id || typeof runtime.sendMessage !== "function") return;
    try {
      const pending = runtime.sendMessage({
        type: "abg_annotation_snapshot",
        pageSessionId: state.pageSessionId,
        cleared,
        annotations: cleared ? [] : snapshotAnnotations(state),
      });
      void Promise.resolve(pending).catch(() => undefined);
    } catch {
      // The extension may have been reloaded; the overlay keeps working without persistence.
    }
  };
  const makeResult = (state: AnnotationState, action: AnnotationAction): AnnotationModeResult => {
    const annotations = snapshotAnnotations(state);
    return {
      ok: true,
      enabled: state.enabled,
      count: annotations.length,
      pageSessionId: state.pageSessionId,
      annotations,
      userMessage:
        action === "start"
          ? "Annotation mode is active. Use Area to drag regions or Text to mark selected page text; click Done or press Escape to stop capturing."
          : undefined,
      nextCommand: "abg annotate <tab>",
    };
  };
  const setRectStyle = (el: HTMLElement, rect: Rect) => {
    el.style.left = `${Math.round(rect.x)}px`;
    el.style.top = `${Math.round(rect.y)}px`;
    el.style.width = `${Math.round(rect.width)}px`;
    el.style.height = `${Math.round(rect.height)}px`;
  };
  const replaceAnnotationRect = (
    state: AnnotationState,
    annotation: Annotation,
    viewportRect: Rect,
  ) => {
    const anchored = viewportToAnchoredRect(state, viewportRect);
    annotation.kind = "screenshot";
    annotation.selector = undefined;
    annotation.element = undefined;
    annotation.rect = anchored.rect;
    annotation.viewportRect = anchored.viewportRect;
    annotation.scroll = anchored.scroll;
    annotation.anchor = anchored.anchor;
  };
  const closeEditor = (state: AnnotationState) => {
    state.editor.hidden = true;
    state.editor.replaceChildren();
  };
  // Saves whatever is typed in an open editor instead of discarding it, for actions
  // that leave the editor implicitly (Done, starting another mark, dragging a box).
  const commitEditor = (state: AnnotationState) => {
    const form = state.editor.hidden ? null : state.editor.querySelector("form");
    if (form) form.requestSubmit();
    else closeEditor(state);
  };
  const showToast = (state: AnnotationState, message: string) => {
    let toast = state.shadow.querySelector<HTMLDivElement>(".abg-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.className = "abg-toast";
      toast.setAttribute("role", "status");
      state.shadow.append(toast);
    }
    if (state.toastTimer) clearTimeout(state.toastTimer);
    toast.textContent = message;
    toast.classList.remove("abg-fading");
    toast.hidden = false;
    const shownToast = toast;
    state.toastTimer = window.setTimeout(() => {
      shownToast.classList.add("abg-fading");
      state.toastTimer = window.setTimeout(() => {
        shownToast.hidden = true;
        state.toastTimer = null;
      }, 220);
    }, 2400);
  };
  const hideToast = (state: AnnotationState) => {
    if (state.toastTimer) clearTimeout(state.toastTimer);
    state.toastTimer = null;
    const toast = state.shadow.querySelector<HTMLDivElement>(".abg-toast");
    if (toast) toast.hidden = true;
  };
  const isTextEditingTarget = (event: Event): boolean => {
    // Events from the overlay's shadow root are retargeted to the host element, so
    // inspect the original target to recognize typing in the comment editor.
    const target = event.composedPath()[0] ?? event.target;
    if (!(target instanceof Element)) return false;
    return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
  };
  const updateToolbar = (state: AnnotationState) => {
    state.toolbar.hidden = !state.enabled;
    const count = state.annotations.length;
    const countEl = state.toolbar.querySelector("[data-count]");
    if (countEl) {
      const countText = ui.count(count);
      if (countEl.textContent !== countText) countEl.textContent = countText;
    }
    const hintEl = state.toolbar.querySelector<HTMLElement>("[data-hint]");
    if (hintEl) {
      const hasSelection =
        state.selectedId !== null && state.annotations.some((item) => item.id === state.selectedId);
      const primaryHint = hasSelection
        ? ui.hintSelected
        : state.mode === "text"
          ? ui.hintText
          : ui.hintArea;
      if (hintEl.dataset.hint !== primaryHint) {
        hintEl.dataset.hint = primaryHint;
        const first = document.createElement("span");
        const second = document.createElement("span");
        first.textContent = primaryHint;
        second.textContent = ui.hintFinish;
        hintEl.replaceChildren(first, second);
      }
    }
    const clearButton = state.toolbar.querySelector<HTMLButtonElement>(
      'button[data-action="clear"]',
    );
    if (clearButton) {
      const armed = count > 0 && (state.clearArmedUntil ?? 0) > Date.now();
      const clearText = armed ? ui.clearConfirm(count) : ui.clear;
      clearButton.disabled = count === 0;
      if (clearButton.textContent !== clearText) clearButton.textContent = clearText;
      clearButton.classList.toggle("abg-danger", armed);
      clearButton.title = armed ? ui.clearConfirmTitle : "";
    }
    for (const modeButton of state.toolbar.querySelectorAll<HTMLButtonElement>(
      "button[data-mode]",
    )) {
      const active = modeButton.dataset.mode === state.mode;
      modeButton.classList.toggle("abg-active", active);
      modeButton.setAttribute("aria-pressed", String(active));
    }
  };
  const editAnnotation = (state: AnnotationState, annotation: Annotation) => {
    closeEditor(state);
    const viewportRect = anchoredToViewportRect(annotation);
    const displayNumber = state.annotations.indexOf(annotation) + 1;
    const form = document.createElement("form");
    const header = document.createElement("div");
    const headerBadge = document.createElement("span");
    const headerTitle = document.createElement("span");
    const headerKeys = document.createElement("span");
    const input = document.createElement("textarea");
    const footer = document.createElement("div");
    const keys = document.createElement("span");
    const actions = document.createElement("span");
    const save = document.createElement("button");
    const remove = document.createElement("button");
    header.className = "abg-editor-header";
    headerBadge.className = "abg-annotation-badge";
    headerBadge.textContent = String(displayNumber);
    headerTitle.textContent = ui.editorTitle(displayNumber);
    headerKeys.className = "abg-editor-keys";
    headerKeys.textContent = ui.editorKeysPrimary;
    header.append(headerBadge, headerTitle, headerKeys);
    input.rows = 1;
    input.placeholder = ui.editorPlaceholder;
    input.value = annotation.comment;
    input.setAttribute("aria-label", ui.editorTitle(displayNumber));
    footer.className = "abg-editor-footer";
    keys.className = "abg-editor-keys";
    keys.textContent = ui.editorKeysNewline;
    actions.className = "abg-editor-actions";
    save.type = "submit";
    save.className = "abg-primary";
    save.textContent = ui.editorSave;
    remove.type = "button";
    remove.className = "abg-danger";
    remove.textContent = ui.editorDelete;
    actions.append(remove, save);
    footer.append(keys, actions);
    form.append(header, input, footer);
    const autoGrow = () => {
      input.style.height = "auto";
      input.style.height = `${Math.min(120, Math.max(34, input.scrollHeight + 2))}px`;
    };
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      annotation.comment = input.value.trim();
      closeEditor(state);
      renderAnnotations(state);
      reportAnnotationsChanged(state);
    });
    input.addEventListener("input", autoGrow);
    input.addEventListener("keydown", (event) => {
      // Enter saves; Shift+Enter inserts a newline; IME composition is left alone.
      if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
      event.preventDefault();
      form.requestSubmit();
    });
    // Keep typing in the editor from reaching page keyboard shortcuts.
    for (const type of ["keydown", "keyup", "keypress"]) {
      form.addEventListener(type, (event) => event.stopPropagation());
    }
    remove.addEventListener("click", () => {
      state.annotations = state.annotations.filter((item) => item.id !== annotation.id);
      if (state.selectedId === annotation.id) state.selectedId = null;
      closeEditor(state);
      renderAnnotations(state);
      reportAnnotationsChanged(state);
    });
    state.editor.append(form);
    state.editor.hidden = false;
    const width = Math.min(360, Math.max(240, innerWidth - 24));
    const left = Math.min(Math.max(12, viewportRect.x), innerWidth - width - 12);
    state.editor.style.width = `${Math.round(width)}px`;
    state.editor.style.left = `${Math.round(left)}px`;
    autoGrow();
    const editorHeight = state.editor.getBoundingClientRect().height || 120;
    // Leave room for the marker's comment chip (below) or number badge (above).
    const gapBelow = annotation.comment ? 36 : 10;
    const below = viewportRect.y + viewportRect.height + gapBelow;
    const top =
      below + editorHeight < innerHeight - 12
        ? below
        : Math.max(12, viewportRect.y - editorHeight - 32);
    state.editor.style.top = `${Math.round(top)}px`;
    input.focus();
    input.select();
  };
  const renderAnnotations = (state: AnnotationState) => {
    state.layer.replaceChildren();
    for (const [index, annotation] of state.annotations.entries()) {
      const rect = anchoredToViewportRect(annotation);
      const isSelected = state.enabled && state.selectedId === annotation.id;
      const canEditRect = annotation.kind === "screenshot";
      const openAnnotationEditor = (event: MouseEvent) => {
        if (!state.enabled) return;
        if (state.suppressClickId === annotation.id) {
          state.suppressClickId = null;
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        state.selectedId = annotation.id;
        event.stopPropagation();
        editAnnotation(state, annotation);
        renderAnnotations(state);
      };
      if (annotation.kind === "text") {
        const group = document.createElement("div");
        const textRects = highlightRectsForTextAnnotation(annotation, rect) ?? [];
        const anchorRect = textRects[0] ?? rect;
        const badge = document.createElement("span");
        const comment = document.createElement("span");
        group.className = [
          "abg-text-selection-group",
          isSelected ? "abg-text-selection-selected" : "",
        ]
          .filter(Boolean)
          .join(" ");
        group.dataset.id = String(annotation.id);
        group.addEventListener("click", openAnnotationEditor);
        for (const textRect of textRects) {
          const piece = document.createElement("span");
          piece.className = "abg-text-selection-piece";
          piece.dataset.id = String(annotation.id);
          piece.role = "button";
          piece.setAttribute("aria-label", ui.annotationLabel(index + 1));
          setRectStyle(piece, textRect);
          group.append(piece);
        }
        badge.className = "abg-text-selection-badge";
        badge.textContent = String(index + 1);
        badge.style.left = `${Math.round(Math.max(2, anchorRect.x - 4))}px`;
        badge.style.top = `${Math.round(Math.max(2, anchorRect.y - 26))}px`;
        comment.className = "abg-text-selection-comment";
        comment.textContent = annotation.comment;
        comment.hidden = annotation.comment.length === 0;
        comment.style.left = `${Math.round(Math.max(8, rect.x))}px`;
        comment.style.top = `${Math.round(Math.min(innerHeight - 34, rect.y + rect.height + 6))}px`;
        comment.style.maxWidth = `${Math.round(Math.min(360, Math.max(120, innerWidth - rect.x - 16)))}px`;
        group.append(badge, comment);
        state.layer.append(group);
        continue;
      }
      const box = document.createElement("button");
      const badge = document.createElement("span");
      const comment = document.createElement("span");
      const handles =
        isSelected && canEditRect
          ? ["n", "ne", "e", "se", "s", "sw", "w", "nw"].map((handle) => {
              const el = document.createElement("span");
              el.className = `abg-resize-handle abg-resize-${handle}`;
              el.dataset.handle = handle;
              return el;
            })
          : [];
      box.type = "button";
      box.className = [
        "abg-annotation-box",
        annotation.kind === "screenshot" ? "abg-annotation-screenshot" : "abg-annotation-dom",
        isSelected ? "abg-annotation-selected" : "",
        // Badge sits above the box and the comment below it unless that leaves the viewport.
        rect.y < 28 ? "abg-badge-inside" : "",
        rect.y + rect.height > innerHeight - 30 ? "abg-comment-inside" : "",
      ]
        .filter(Boolean)
        .join(" ");
      box.dataset.id = String(annotation.id);
      box.setAttribute("aria-label", ui.annotationLabel(index + 1));
      setRectStyle(box, rect);
      badge.className = "abg-annotation-badge";
      badge.textContent = String(index + 1);
      comment.className = "abg-annotation-comment";
      comment.textContent = annotation.comment;
      comment.hidden = annotation.comment.length === 0;
      box.append(badge, comment, ...handles);
      box.addEventListener("mousedown", (event) => {
        if (!state.enabled || event.button !== 0) return;
        if (!canEditRect) return;
        const target = event.target instanceof HTMLElement ? event.target : null;
        const handle = target?.dataset.handle;
        state.selectedId = annotation.id;
        state.editGesture = {
          annotationId: annotation.id,
          mode: handle ? "resize" : "move",
          handle,
          startX: event.clientX,
          startY: event.clientY,
          startRect: rect,
          didMove: false,
        };
        commitEditor(state);
        box.classList.add("abg-annotation-selected");
        event.preventDefault();
        event.stopPropagation();
      });
      box.addEventListener("click", (event) => {
        openAnnotationEditor(event);
      });
      state.layer.append(box);
    }
    updateToolbar(state);
  };
  const ensureRenderTimer = (state: AnnotationState) => {
    if (state.renderTimer !== null) return;
    state.renderTimer = window.setInterval(() => {
      if (state.annotations.length > 0) renderAnnotations(state);
    }, 150);
  };
  const addAnnotation = (
    state: AnnotationState,
    viewportRect: Rect,
    options: {
      kind: Annotation["kind"];
      source: Annotation["source"];
      comment?: string;
      selector?: string;
      text?: string;
      textAnchor?: Annotation["textAnchor"];
      element?: Annotation["element"];
      openEditor?: boolean;
    },
  ) => {
    const anchored = viewportToAnchoredRect(state, viewportRect);
    const annotation: Annotation = {
      id: state.nextId++,
      uid: makeUid(),
      kind: options.kind,
      source: options.source,
      comment: options.comment?.trim() ?? "",
      selector: options.selector,
      text: options.text,
      textAnchor: options.textAnchor,
      rect: anchored.rect,
      viewportRect: anchored.viewportRect,
      scroll: anchored.scroll,
      anchor: anchored.anchor,
      createdAt: new Date().toISOString(),
      url: location.href,
      title: document.title,
      element: options.element ?? elementAtCenter(state, viewportRect),
    };
    state.annotations.push(annotation);
    renderAnnotations(state);
    reportAnnotationsChanged(state);
    if (options.openEditor ?? annotation.comment.length === 0) editAnnotation(state, annotation);
    return annotation;
  };
  const addAutoAnnotation = (
    state: AnnotationState,
    viewportRect: Rect,
    options: { source: Annotation["source"]; comment?: string; openEditor?: boolean },
  ) => {
    const domTarget = inferDomTarget(state, viewportRect);
    if (domTarget) {
      return addAnnotation(state, domTarget.rect, {
        kind: "dom",
        source: options.source,
        selector: domTarget.selector,
        comment: options.comment,
        element: domTarget.element,
        openEditor: options.openEditor,
      });
    }
    return addAnnotation(state, viewportRect, {
      kind: "screenshot",
      source: options.source,
      comment: options.comment,
      openEditor: options.openEditor,
    });
  };
  const addTextSelectionAnnotation = (state: AnnotationState) => {
    if (!state.enabled || state.mode !== "text") return;
    const target = selectionAnnotationTarget(state);
    if (!target || target.signature === state.lastSelectionSignature) return;
    state.lastSelectionSignature = target.signature;
    addAnnotation(state, target.rect, {
      kind: "text",
      source: "selection",
      text: target.text,
      textAnchor: target.textAnchor,
      element: target.element,
      openEditor: true,
    });
    getSelection()?.removeAllRanges();
  };
  const applyInteractionMode = (state: AnnotationState) => {
    const areaEnabled = state.enabled && state.mode === "area";
    state.capture.hidden = !areaEnabled;
    state.capture.style.pointerEvents = areaEnabled ? "auto" : "none";
    state.host.style.pointerEvents = state.enabled ? "auto" : "none";
    state.layer.style.pointerEvents = "none";
    updateToolbar(state);
  };
  const setMode = (state: AnnotationState, mode: AnnotationState["mode"]) => {
    state.mode = mode;
    state.dragStart = null;
    state.activeDraft = null;
    state.draft.hidden = true;
    state.lastSelectionSignature = null;
    if (mode === "area") getSelection()?.removeAllRanges();
    applyInteractionMode(state);
  };
  const setEnabled = (state: AnnotationState, enabled: boolean) => {
    const wasEnabled = state.enabled;
    if (!enabled && wasEnabled) commitEditor(state);
    state.enabled = enabled;
    if (!enabled) {
      if (wasEnabled) showToast(state, ui.doneToast(state.annotations.length));
      state.clearArmedUntil = 0;
      state.dragStart = null;
      state.activeDraft = null;
      state.selectedId = null;
      state.editGesture = null;
      state.suppressClickId = null;
      state.lastSelectionSignature = null;
      state.draft.hidden = true;
      closeEditor(state);
      renderAnnotations(state);
      applyInteractionMode(state);
      return;
    }
    hideToast(state);
    applyInteractionMode(state);
  };
  const createState = (): AnnotationState => {
    document.getElementById("__abg_annotation_mode")?.remove();
    const host = document.createElement("div");
    host.id = "__abg_annotation_mode";
    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = `
          :host {
            all: initial;
            color-scheme: light;
          }
          [hidden] {
            display: none !important;
          }
          /*
           * Design tokens mirror extension/public/ui.css. They are declared on the
           * top-level overlay nodes (not :host) so page CSS that targets the host
           * element cannot override them, and every inheritable text property is
           * reset here so page fonts and colors never leak into the overlay.
           */
          .abg-capture,
          .abg-layer,
          .abg-toolbar,
          .abg-draft,
          .abg-editor,
          .abg-toast {
            --abg-font: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, "Hiragino Sans",
              "Yu Gothic UI", "Meiryo UI", sans-serif;
            --abg-mark: #1a73e8;
            --abg-mark-fill: rgba(26, 115, 232, 0.14);
            --abg-mark-fill-hover: rgba(26, 115, 232, 0.22);
            --abg-mark-ring: rgba(26, 115, 232, 0.35);
            --abg-chip-bg: rgba(10, 10, 10, 0.86);
            --abg-surface: #ffffff;
            --abg-surface-2: #f3f4f2;
            --abg-text: #0a0a0a;
            --abg-muted: #5c5f66;
            --abg-line: #dedfdd;
            --abg-line-strong: #c4c6c2;
            --abg-inverse: #0a0a0a;
            --abg-on-inverse: #ffffff;
            --abg-danger: #d92d20;
            --abg-danger-text: #b42318;
            --abg-danger-bg: #fdecea;
            --abg-danger-line: #f4b4ad;
            --abg-focus: #1a73e8;
            --abg-shadow: 0 6px 24px rgba(0, 0, 0, 0.14), 0 1px 3px rgba(0, 0, 0, 0.08);
            box-sizing: border-box;
            color: var(--abg-text);
            font: 400 12px/1.3 var(--abg-font);
            font-style: normal;
            letter-spacing: normal;
            text-align: left;
            text-decoration: none;
            text-shadow: none;
            text-transform: none;
            visibility: visible;
            white-space: normal;
            word-spacing: normal;
          }
          @media (prefers-color-scheme: dark) {
            .abg-toolbar,
            .abg-editor,
            .abg-toast {
              color-scheme: dark;
              --abg-surface: #1f1f22;
              --abg-surface-2: #29292d;
              --abg-text: #f2f2f3;
              --abg-muted: #a6a8ae;
              --abg-line: #333338;
              --abg-line-strong: #4a4a51;
              --abg-inverse: #f2f2f3;
              --abg-on-inverse: #0a0a0a;
              --abg-danger-text: #ff8b80;
              --abg-danger-bg: rgba(255, 69, 58, 0.16);
              --abg-danger-line: rgba(255, 69, 58, 0.45);
              --abg-focus: #6ea8ff;
              --abg-shadow: 0 8px 28px rgba(0, 0, 0, 0.5), 0 1px 3px rgba(0, 0, 0, 0.3);
            }
          }
          .abg-capture,
          .abg-layer {
            position: fixed;
            inset: 0;
            width: 100vw;
            height: 100vh;
          }
          .abg-capture {
            z-index: 2147483644;
            cursor: crosshair;
            background: rgba(0, 0, 0, 0.02);
          }
          .abg-layer {
            z-index: 2147483645;
            pointer-events: auto;
          }
          button {
            box-sizing: border-box;
            margin: 0;
            font: inherit;
          }
          button:focus-visible,
          textarea:focus-visible {
            outline: 2px solid var(--abg-focus);
            outline-offset: 2px;
          }
          .abg-toolbar {
            position: fixed;
            top: 12px;
            right: 12px;
            z-index: 2147483647;
            display: flex;
            align-items: center;
            gap: 8px;
            max-width: calc(100vw - 24px);
            padding: 6px;
            border: 1px solid var(--abg-line);
            border-radius: 10px;
            background: var(--abg-surface);
            box-shadow: var(--abg-shadow);
            pointer-events: auto;
            user-select: none;
          }
          .abg-chip {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 0 4px 0 6px;
            font-weight: 600;
            white-space: nowrap;
          }
          .abg-dot {
            width: 8px;
            height: 8px;
            border-radius: 999px;
            background: var(--abg-mark);
            box-shadow: 0 0 0 3px var(--abg-mark-ring);
          }
          .abg-segmented {
            display: inline-flex;
            padding: 2px;
            border: 1px solid var(--abg-line);
            border-radius: 8px;
            background: var(--abg-surface-2);
          }
          .abg-toolbar button,
          .abg-editor button {
            appearance: none;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-height: 28px;
            padding: 4px 10px;
            border: 1px solid var(--abg-line-strong);
            border-radius: 6px;
            background: var(--abg-surface);
            color: var(--abg-text);
            font-weight: 500;
            white-space: nowrap;
            cursor: pointer;
          }
          .abg-toolbar button:hover:not(:disabled),
          .abg-editor button:hover:not(:disabled) {
            background: var(--abg-surface-2);
          }
          .abg-toolbar button:disabled {
            cursor: default;
            opacity: 0.45;
          }
          .abg-segmented button {
            min-height: 24px;
            padding: 2px 10px;
            border-color: transparent;
            background: transparent;
            color: var(--abg-muted);
          }
          .abg-segmented button:hover:not(:disabled) {
            background: transparent;
            color: var(--abg-text);
          }
          .abg-toolbar .abg-segmented button.abg-active {
            border-color: var(--abg-line);
            background: var(--abg-surface);
            color: var(--abg-text);
            font-weight: 600;
            box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
          }
          .abg-count {
            min-width: 0;
            color: var(--abg-muted);
            font-variant-numeric: tabular-nums;
            white-space: nowrap;
          }
          .abg-hint {
            display: inline-flex;
            gap: 6px;
            padding-left: 8px;
            border-left: 1px solid var(--abg-line);
            color: var(--abg-muted);
            white-space: nowrap;
          }
          .abg-hint span + span::before {
            content: "·";
            margin-right: 6px;
          }
          .abg-toolbar button.abg-danger,
          .abg-toolbar button.abg-danger:hover:not(:disabled) {
            border-color: var(--abg-danger-line);
            background: var(--abg-danger-bg);
            color: var(--abg-danger-text);
          }
          .abg-toolbar button.abg-primary,
          .abg-editor button.abg-primary {
            border-color: transparent;
            background: var(--abg-inverse);
            color: var(--abg-on-inverse);
            font-weight: 600;
          }
          .abg-toolbar button.abg-primary:hover,
          .abg-editor button.abg-primary:hover {
            background: var(--abg-inverse);
            opacity: 0.86;
          }
          @media (max-width: 760px) {
            .abg-hint {
              display: none;
            }
          }
          @media (max-width: 520px) {
            .abg-count {
              display: none;
            }
          }
          .abg-draft,
          .abg-annotation-box {
            position: fixed;
            box-sizing: border-box;
            border: 2px solid var(--abg-mark);
            border-radius: 4px;
            background: var(--abg-mark-fill);
          }
          .abg-draft {
            z-index: 2147483646;
            border-style: dashed;
            pointer-events: none;
          }
          .abg-annotation-box {
            z-index: 2147483646;
            margin: 0;
            padding: 0;
            pointer-events: auto;
            text-align: left;
          }
          .abg-annotation-screenshot {
            cursor: move;
          }
          .abg-annotation-dom,
          .abg-annotation-text {
            cursor: pointer;
          }
          .abg-annotation-box:hover {
            background: var(--abg-mark-fill-hover);
          }
          .abg-annotation-box:focus-visible {
            outline: 2px solid var(--abg-mark);
            outline-offset: 3px;
          }
          .abg-text-selection-group {
            position: fixed;
            inset: 0;
            z-index: 2147483646;
            pointer-events: none;
          }
          .abg-text-selection-piece {
            position: fixed;
            box-sizing: border-box;
            margin: 0;
            padding: 0;
            border: 0;
            border-radius: 2px;
            background: rgba(26, 115, 232, 0.24);
            box-shadow: inset 0 -2px 0 var(--abg-mark);
            pointer-events: auto;
            cursor: pointer;
          }
          .abg-text-selection-piece:hover,
          .abg-text-selection-selected .abg-text-selection-piece {
            background: rgba(26, 115, 232, 0.34);
          }
          .abg-text-selection-selected .abg-text-selection-piece {
            box-shadow:
              0 0 0 2px var(--abg-mark-ring),
              inset 0 -2px 0 var(--abg-mark);
          }
          .abg-annotation-selected {
            box-shadow:
              0 0 0 1px #ffffff,
              0 0 0 4px var(--abg-mark-ring);
          }
          .abg-annotation-badge,
          .abg-text-selection-badge {
            box-sizing: border-box;
            min-width: 22px;
            height: 22px;
            padding: 0 6px;
            border: 2px solid #ffffff;
            border-radius: 999px;
            background: var(--abg-mark);
            color: #ffffff;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            font: 700 12px/1 var(--abg-font);
            font-variant-numeric: tabular-nums;
            box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
          }
          .abg-annotation-badge {
            position: absolute;
            left: -4px;
            top: -26px;
          }
          .abg-badge-inside .abg-annotation-badge {
            top: 4px;
            left: 4px;
          }
          .abg-text-selection-badge {
            position: fixed;
            z-index: 2147483647;
            pointer-events: auto;
            cursor: pointer;
          }
          .abg-annotation-comment,
          .abg-text-selection-comment {
            box-sizing: border-box;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            border-radius: 6px;
            padding: 4px 8px;
            background: var(--abg-chip-bg);
            color: #ffffff;
            font: 500 12px/1.3 var(--abg-font);
            box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
          }
          .abg-annotation-comment {
            position: absolute;
            left: -2px;
            top: calc(100% + 4px);
            max-width: max(180px, calc(100% + 4px));
          }
          .abg-comment-inside .abg-annotation-comment {
            top: auto;
            bottom: 6px;
            left: 6px;
            max-width: calc(100% - 12px);
          }
          .abg-text-selection-comment {
            position: fixed;
            z-index: 2147483647;
            pointer-events: auto;
            cursor: pointer;
          }
          .abg-resize-handle {
            position: absolute;
            display: block;
            pointer-events: auto;
            background: transparent;
          }
          .abg-annotation-selected .abg-resize-handle::after {
            content: "";
            position: absolute;
            box-sizing: border-box;
            width: 10px;
            height: 10px;
            border: 2px solid var(--abg-mark);
            border-radius: 3px;
            background: #ffffff;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
          }
          .abg-resize-n,
          .abg-resize-s {
            left: 12px;
            right: 12px;
            height: 12px;
            cursor: ns-resize;
          }
          .abg-resize-n {
            top: -6px;
          }
          .abg-resize-s {
            bottom: -6px;
          }
          .abg-resize-e,
          .abg-resize-w {
            top: 12px;
            bottom: 12px;
            width: 12px;
            cursor: ew-resize;
          }
          .abg-resize-e {
            right: -6px;
          }
          .abg-resize-w {
            left: -6px;
          }
          .abg-resize-ne,
          .abg-resize-se,
          .abg-resize-sw,
          .abg-resize-nw {
            width: 16px;
            height: 16px;
          }
          .abg-resize-ne {
            top: -8px;
            right: -8px;
            cursor: nesw-resize;
          }
          .abg-resize-se {
            right: -8px;
            bottom: -8px;
            cursor: nwse-resize;
          }
          .abg-resize-sw {
            left: -8px;
            bottom: -8px;
            cursor: nesw-resize;
          }
          .abg-resize-nw {
            top: -8px;
            left: -8px;
            cursor: nwse-resize;
          }
          .abg-resize-n::after {
            top: 1px;
            left: calc(50% - 5px);
          }
          .abg-resize-s::after {
            bottom: 1px;
            left: calc(50% - 5px);
          }
          .abg-resize-e::after {
            top: calc(50% - 5px);
            right: 1px;
          }
          .abg-resize-w::after {
            top: calc(50% - 5px);
            left: 1px;
          }
          .abg-resize-ne::after {
            top: 3px;
            right: 3px;
          }
          .abg-resize-se::after {
            right: 3px;
            bottom: 3px;
          }
          .abg-resize-sw::after {
            left: 3px;
            bottom: 3px;
          }
          .abg-resize-nw::after {
            top: 3px;
            left: 3px;
          }
          .abg-editor {
            position: fixed;
            z-index: 2147483647;
            pointer-events: auto;
          }
          .abg-editor form {
            display: flex;
            flex-direction: column;
            gap: 8px;
            margin: 0;
            padding: 10px;
            border: 1px solid var(--abg-line);
            border-radius: 10px;
            background: var(--abg-surface);
            box-shadow: var(--abg-shadow);
          }
          .abg-editor-header {
            display: flex;
            align-items: center;
            gap: 8px;
            font-weight: 600;
          }
          .abg-editor-header .abg-annotation-badge {
            position: static;
            border-color: transparent;
            box-shadow: none;
          }
          .abg-editor textarea {
            box-sizing: border-box;
            display: block;
            width: 100%;
            min-height: 34px;
            max-height: 120px;
            margin: 0;
            padding: 7px 9px;
            border: 1px solid var(--abg-line-strong);
            border-radius: 6px;
            background: var(--abg-surface);
            color: var(--abg-text);
            font: 400 13px/1.4 var(--abg-font);
            resize: none;
            overflow-y: auto;
          }
          .abg-editor textarea:focus-visible {
            outline-offset: 0;
            border-color: var(--abg-focus);
          }
          .abg-editor textarea::placeholder {
            color: var(--abg-muted);
          }
          .abg-editor-footer {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
          }
          .abg-editor-header .abg-editor-keys {
            margin-left: auto;
            font-weight: 400;
          }
          .abg-editor-keys {
            min-width: 0;
            color: var(--abg-muted);
            font-size: 11px;
          }
          .abg-editor-actions {
            display: inline-flex;
            flex: 0 0 auto;
            gap: 6px;
          }
          .abg-editor button.abg-danger {
            border-color: var(--abg-danger-line);
            background: transparent;
            color: var(--abg-danger-text);
          }
          .abg-editor button.abg-danger:hover {
            background: var(--abg-danger-bg);
          }
          .abg-toast {
            position: fixed;
            top: 12px;
            right: 12px;
            z-index: 2147483647;
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px 12px;
            border: 1px solid var(--abg-line);
            border-radius: 10px;
            background: var(--abg-surface);
            box-shadow: var(--abg-shadow);
            font-weight: 500;
            pointer-events: none;
            transition: opacity 200ms ease;
          }
          .abg-toast::before {
            content: "";
            width: 8px;
            height: 8px;
            border-radius: 999px;
            background: #34c759;
          }
          .abg-toast.abg-fading {
            opacity: 0;
          }
          @media (prefers-reduced-motion: reduce) {
            .abg-toast {
              transition: none;
            }
          }
        `;
    const capture = document.createElement("div");
    const layer = document.createElement("div");
    const toolbar = document.createElement("div");
    const draft = document.createElement("div");
    const editor = document.createElement("div");
    capture.className = "abg-capture";
    layer.className = "abg-layer";
    toolbar.className = "abg-toolbar";
    draft.className = "abg-draft";
    editor.className = "abg-editor";
    capture.hidden = true;
    draft.hidden = true;
    editor.hidden = true;
    toolbar.hidden = true;
    capture.style.pointerEvents = "none";
    layer.style.pointerEvents = "none";
    host.style.pointerEvents = "none";
    const toolbarNode = (tag: string, className?: string, text?: string): HTMLElement => {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    };
    const toolbarButton = (action: string, text: string, className?: string) => {
      const button = toolbarNode("button", className, text) as HTMLButtonElement;
      button.type = "button";
      button.dataset.action = action;
      return button;
    };
    const chip = toolbarNode("span", "abg-chip");
    chip.append(toolbarNode("span", "abg-dot"), ui.annotating);
    const modeGroup = toolbarNode("span", "abg-segmented");
    modeGroup.setAttribute("role", "group");
    modeGroup.setAttribute("aria-label", ui.modeGroup);
    const areaButton = toolbarButton("mode-area", ui.modeArea);
    areaButton.dataset.mode = "area";
    areaButton.setAttribute("aria-pressed", "true");
    const textButton = toolbarButton("mode-text", ui.modeText);
    textButton.dataset.mode = "text";
    textButton.setAttribute("aria-pressed", "false");
    modeGroup.append(areaButton, textButton);
    const countEl = toolbarNode("span", "abg-count", ui.count(0));
    countEl.dataset.count = "";
    countEl.setAttribute("aria-live", "polite");
    const hintEl = toolbarNode("span", "abg-hint");
    hintEl.dataset.hint = "";
    const doneButton = toolbarButton("done", ui.done, "abg-primary");
    doneButton.title = ui.doneTitle;
    toolbar.setAttribute("role", "toolbar");
    toolbar.setAttribute("aria-label", ui.annotating);
    toolbar.append(chip, modeGroup, countEl, hintEl, toolbarButton("clear", ui.clear), doneButton);
    shadow.append(style, capture, layer, draft, editor, toolbar);
    document.documentElement.append(host);

    const state: AnnotationState = {
      enabled: false,
      mode: "area",
      nextId: 1,
      selectedId: null,
      annotations: [],
      host,
      shadow,
      capture,
      layer,
      toolbar,
      draft,
      editor,
      dragStart: null,
      activeDraft: null,
      renderTimer: null,
      editGesture: null,
      suppressClickId: null,
      lastSelectionSignature: null,
      pageSessionId: makeUid(),
      persist: requestedCommand.persist === true,
    };
    capture.addEventListener("mousedown", (event) => {
      if (!state.enabled || event.button !== 0) return;
      commitEditor(state);
      state.dragStart = { x: event.clientX, y: event.clientY };
      state.activeDraft = { x: event.clientX, y: event.clientY, width: 0, height: 0 };
      setRectStyle(draft, state.activeDraft);
      draft.hidden = false;
      event.preventDefault();
      event.stopPropagation();
    });
    capture.addEventListener("mousemove", (event) => {
      if (!state.dragStart) return;
      state.activeDraft = normalizeRect(state.dragStart, {
        x: event.clientX,
        y: event.clientY,
      });
      setRectStyle(draft, state.activeDraft);
      event.preventDefault();
      event.stopPropagation();
    });
    capture.addEventListener("mouseup", (event) => {
      if (!state.dragStart || !state.activeDraft) return;
      const rect = normalizeRect(state.dragStart, { x: event.clientX, y: event.clientY });
      state.dragStart = null;
      state.activeDraft = null;
      draft.hidden = true;
      if (rect.width >= 8 && rect.height >= 8) {
        addAutoAnnotation(state, rect, {
          source: "drag",
          openEditor: true,
        });
      } else {
        const domTarget = inferDomTarget(state, {
          x: event.clientX,
          y: event.clientY,
          width: 1,
          height: 1,
        });
        if (domTarget) {
          addAnnotation(state, domTarget.rect, {
            kind: "dom",
            source: "drag",
            selector: domTarget.selector,
            element: domTarget.element,
            openEditor: true,
          });
        }
      }
      event.preventDefault();
      event.stopPropagation();
    });
    toolbar.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const button = target?.closest<HTMLButtonElement>("button[data-action]");
      const action = button?.dataset.action;
      if (action === "done") setEnabled(state, false);
      if (action === "mode-area") setMode(state, "area");
      if (action === "mode-text") setMode(state, "text");
      if (action === "clear" && (state.clearArmedUntil ?? 0) <= Date.now()) {
        // First click arms the destructive action; the 150ms render tick disarms it.
        state.clearArmedUntil = Date.now() + 3000;
        updateToolbar(state);
      } else if (action === "clear") {
        state.clearArmedUntil = 0;
        state.annotations = [];
        state.nextId = 1;
        state.selectedId = null;
        state.editGesture = null;
        state.lastSelectionSignature = null;
        closeEditor(state);
        renderAnnotations(state);
        reportAnnotationsChanged(state, true);
      }
      if (action) {
        event.preventDefault();
        event.stopPropagation();
      }
    });
    addEventListener(
      "mousemove",
      (event) => {
        const gesture = state.editGesture;
        if (!gesture) return;
        const annotation = state.annotations.find((item) => item.id === gesture.annotationId);
        if (!annotation) {
          state.editGesture = null;
          return;
        }
        if (annotation.kind !== "screenshot") {
          state.editGesture = null;
          return;
        }
        const dx = event.clientX - gesture.startX;
        const dy = event.clientY - gesture.startY;
        const moved = Math.abs(dx) > 1 || Math.abs(dy) > 1;
        if (moved) gesture.didMove = true;
        const nextRect =
          gesture.mode === "move"
            ? clampRect({
                x: gesture.startRect.x + dx,
                y: gesture.startRect.y + dy,
                width: gesture.startRect.width,
                height: gesture.startRect.height,
              })
            : resizedRect(gesture.startRect, gesture.handle ?? "se", dx, dy);
        replaceAnnotationRect(state, annotation, nextRect);
        state.selectedId = annotation.id;
        state.suppressClickId = annotation.id;
        renderAnnotations(state);
        event.preventDefault();
        event.stopPropagation();
      },
      true,
    );
    addEventListener(
      "mouseup",
      (event) => {
        if (state.enabled && state.mode === "text" && !state.editGesture) {
          window.setTimeout(() => addTextSelectionAnnotation(state), 0);
          return;
        }
        if (!state.editGesture) return;
        const didMove = state.editGesture.didMove;
        if (didMove) state.suppressClickId = state.editGesture.annotationId;
        state.editGesture = null;
        if (didMove) {
          renderAnnotations(state);
          reportAnnotationsChanged(state);
        }
        event.preventDefault();
        event.stopPropagation();
      },
      true,
    );
    addEventListener(
      "keydown",
      (event) => {
        if (event.key === "Escape" && state.enabled) {
          // Escape backs out one level: cancel an open comment first, then finish.
          if (!state.editor.hidden) closeEditor(state);
          else setEnabled(state, false);
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        if (
          state.enabled &&
          (event.key === "Delete" || event.key === "Backspace") &&
          state.selectedId !== null &&
          !isTextEditingTarget(event)
        ) {
          state.annotations = state.annotations.filter((item) => item.id !== state.selectedId);
          state.selectedId = null;
          state.editGesture = null;
          closeEditor(state);
          renderAnnotations(state);
          reportAnnotationsChanged(state);
          event.preventDefault();
          event.stopPropagation();
        }
      },
      true,
    );
    addEventListener(
      "keyup",
      () => {
        if (state.enabled && state.mode === "text") {
          window.setTimeout(() => addTextSelectionAnnotation(state), 0);
        }
      },
      true,
    );
    addEventListener("scroll", () => renderAnnotations(state), true);
    addEventListener("resize", () => renderAnnotations(state), true);
    ensureRenderTimer(state);
    return state;
  };

  // ---------- Restore after reload (issue #440) ----------
  // Re-anchors saved annotations against the live DOM. An annotation is placed only when its
  // target can be identified unambiguously; everything else is reported as unrestored with a
  // reason and is never drawn at a guessed position.
  type SavedInput = {
    uid?: unknown;
    kind?: unknown;
    source?: unknown;
    comment?: unknown;
    displayNumber?: unknown;
    selector?: unknown;
    text?: unknown;
    textAnchor?: unknown;
    rect?: unknown;
    anchor?: unknown;
    createdAt?: unknown;
    element?: unknown;
  };
  type RestoreOutcome =
    | { ok: true; annotation: Annotation }
    | { ok: false; reason: string; selector?: string };
  const isPlainObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);
  const savedRect = (value: unknown): Rect | null => {
    if (!isPlainObject(value)) return null;
    const { x, y, width, height } = value;
    if (
      typeof x !== "number" ||
      typeof y !== "number" ||
      typeof width !== "number" ||
      typeof height !== "number" ||
      ![x, y, width, height].every(Number.isFinite)
    ) {
      return null;
    }
    return { x, y, width, height };
  };
  const queryUnique = (selector: string): { element: Element } | { reason: string } => {
    let matches: NodeListOf<Element>;
    try {
      matches = document.querySelectorAll(selector);
    } catch {
      return { reason: "selector_invalid" };
    }
    if (matches.length === 0) return { reason: "selector_not_found" };
    if (matches.length > 1) return { reason: "selector_ambiguous" };
    return { element: matches[0] as Element };
  };
  const restoredBase = (state: AnnotationState, saved: SavedInput, uid: string) => ({
    id: state.nextId++,
    uid,
    source: (saved.source === "drag" || saved.source === "selection" || saved.source === "cli"
      ? saved.source
      : "cli") as Annotation["source"],
    comment: typeof saved.comment === "string" ? saved.comment : "",
    createdAt: typeof saved.createdAt === "string" ? saved.createdAt : new Date().toISOString(),
    url: location.href,
    title: document.title,
    restoredAt: new Date().toISOString(),
  });
  const restoreDomAnnotation = (
    state: AnnotationState,
    saved: SavedInput,
    uid: string,
  ): RestoreOutcome => {
    const savedElement = isPlainObject(saved.element) ? saved.element : null;
    const candidates = [saved.selector, savedElement?.selector].filter(
      (value, index, list): value is string =>
        typeof value === "string" && value.length > 0 && list.indexOf(value) === index,
    );
    if (candidates.length === 0) return { ok: false, reason: "selector_missing" };
    let lastFailure: { reason: string; selector?: string } = { reason: "selector_not_found" };
    for (const selector of candidates) {
      const lookup = queryUnique(selector);
      if ("reason" in lookup) {
        lastFailure = { reason: lookup.reason, selector };
        continue;
      }
      const metadata = metadataForElement(lookup.element);
      if (typeof savedElement?.tag === "string" && savedElement.tag !== metadata.tag) {
        lastFailure = { reason: "element_changed", selector };
        continue;
      }
      if (
        typeof savedElement?.text === "string" &&
        savedElement.text.length > 0 &&
        trimText(savedElement.text) !== metadata.text
      ) {
        lastFailure = { reason: "element_text_changed", selector };
        continue;
      }
      let viewportRect: Rect;
      try {
        viewportRect = rectForElement(lookup.element);
      } catch {
        lastFailure = { reason: "target_not_visible", selector };
        continue;
      }
      const anchored = viewportToAnchoredRect(state, viewportRect);
      return {
        ok: true,
        annotation: {
          ...restoredBase(state, saved, uid),
          kind: "dom",
          selector,
          rect: anchored.rect,
          viewportRect: anchored.viewportRect,
          scroll: anchored.scroll,
          anchor: anchored.anchor,
          element: metadata,
          restoredBy: "selector",
        },
      };
    }
    return { ok: false, ...lastFailure };
  };
  const restoreTextAnnotation = (
    state: AnnotationState,
    saved: SavedInput,
    uid: string,
  ): RestoreOutcome => {
    const savedAnchor = isPlainObject(saved.textAnchor)
      ? (saved.textAnchor as NonNullable<Annotation["textAnchor"]>)
      : null;
    const text = typeof saved.text === "string" ? saved.text : "";
    const needle = normalizeSelectionText(text);
    if (!savedAnchor || typeof savedAnchor.selector !== "string" || !needle) {
      return { ok: false, reason: "text_anchor_missing" };
    }
    const lookup = queryUnique(savedAnchor.selector);
    if ("reason" in lookup) {
      return {
        ok: false,
        reason: lookup.reason.replace("selector_", "text_container_"),
        selector: savedAnchor.selector,
      };
    }
    const root = lookup.element;
    let range: Range | null = null;
    let index = typeof savedAnchor.index === "number" ? savedAnchor.index : undefined;
    const direct = rangeForTextAnchor(root, savedAnchor);
    if (direct && normalizeSelectionText(direct.toString()) === needle) range = direct;
    if (!range) {
      // Exact text match only. With several matches, the saved match index must still point
      // at one of them; otherwise the annotation is ambiguous and is not placed.
      const map = normalizedTextMapFor(root);
      const indexes: number[] = [];
      let fromIndex = 0;
      while (indexes.length < 100) {
        const found = map.text.indexOf(needle, fromIndex);
        if (found < 0) break;
        indexes.push(found);
        fromIndex = found + Math.max(1, needle.length);
      }
      if (indexes.length === 0) {
        return { ok: false, reason: "text_not_found", selector: savedAnchor.selector };
      }
      const chosen =
        index !== undefined && indexes.includes(index)
          ? index
          : indexes.length === 1
            ? indexes[0]
            : undefined;
      if (chosen === undefined) {
        return { ok: false, reason: "text_ambiguous", selector: savedAnchor.selector };
      }
      index = chosen;
      range = rangeForTextMapSpan(map.points, chosen, needle.length);
      if (!range) return { ok: false, reason: "text_not_found", selector: savedAnchor.selector };
    }
    const bounding = range.getBoundingClientRect();
    if (bounding.width < 1 || bounding.height < 1) {
      return { ok: false, reason: "target_not_visible", selector: savedAnchor.selector };
    }
    const viewportRect: Rect = {
      x: Math.round(bounding.left),
      y: Math.round(bounding.top),
      width: Math.round(bounding.width),
      height: Math.round(bounding.height),
    };
    const anchored = viewportToAnchoredRect(state, viewportRect);
    const textAnchor = rangeAnchorFor(root, range, rangeRects(range)?.rect ?? viewportRect) ?? {
      selector: selectorInfoFor(root).selector,
    };
    textAnchor.index = index;
    return {
      ok: true,
      annotation: {
        ...restoredBase(state, saved, uid),
        kind: "text",
        text,
        textAnchor,
        rect: anchored.rect,
        viewportRect: anchored.viewportRect,
        scroll: anchored.scroll,
        anchor: anchored.anchor,
        element: metadataForTextSelection(root, text),
        restoredBy: "text",
      },
    };
  };
  const restoreScreenshotAnnotation = (
    state: AnnotationState,
    saved: SavedInput,
    uid: string,
  ): RestoreOutcome => {
    const rect = savedRect(saved.rect);
    if (!rect || rect.width < 1 || rect.height < 1) return { ok: false, reason: "rect_invalid" };
    const savedAnchor = isPlainObject(saved.anchor) ? saved.anchor : null;
    let anchor: ScrollAnchor = { type: "window" };
    let restoredBy: AnnotationRestoredBy = "coordinates";
    if (
      (savedAnchor?.type === "frame" || savedAnchor?.type === "element") &&
      typeof savedAnchor.selector === "string"
    ) {
      const lookup = queryUnique(savedAnchor.selector);
      if ("reason" in lookup) {
        return {
          ok: false,
          reason: lookup.reason.replace("selector_", "anchor_"),
          selector: savedAnchor.selector,
        };
      }
      const usable =
        savedAnchor.type === "frame"
          ? frameWindowFor(lookup.element) !== null
          : lookup.element instanceof HTMLElement;
      if (!usable) {
        return { ok: false, reason: "anchor_not_accessible", selector: savedAnchor.selector };
      }
      anchor = { type: savedAnchor.type, selector: savedAnchor.selector };
      restoredBy = "anchor";
    } else {
      // Window-anchored regions have no DOM target to verify. They come back at the same
      // document coordinates, marked restoredBy: "coordinates", unless the page is now
      // too small to contain them.
      const root = document.documentElement;
      const pageWidth = Math.max(root.scrollWidth, document.body?.scrollWidth ?? 0);
      const pageHeight = Math.max(root.scrollHeight, document.body?.scrollHeight ?? 0);
      if (rect.x >= pageWidth || rect.y >= pageHeight) {
        return { ok: false, reason: "outside_page" };
      }
    }
    const savedElement = isPlainObject(saved.element)
      ? (saved.element as Annotation["element"])
      : undefined;
    const annotation: Annotation = {
      ...restoredBase(state, saved, uid),
      kind: "screenshot",
      rect,
      viewportRect: rect,
      scroll: scrollForAnchor(anchor),
      anchor,
      element: savedElement,
      restoredBy,
    };
    annotation.viewportRect = storedAnnotationRectToViewport(annotation);
    return { ok: true, annotation };
  };
  // Restore is additive and idempotent: saved annotations whose uid is already live in the page
  // are skipped (counted in alreadyPresent), so running restore twice never duplicates them.
  const restoreSavedAnnotations = (
    state: AnnotationState,
    savedList: unknown[],
  ): AnnotationRestoreReport => {
    const report: AnnotationRestoreReport = {
      status: "already_present",
      restored: [],
      unrestored: [],
      alreadyPresent: 0,
    };
    const seen = new Set(state.annotations.map((annotation) => annotation.uid));
    for (const item of savedList) {
      if (!isPlainObject(item) || typeof item.uid !== "string") continue;
      const saved = item as SavedInput;
      const uid = item.uid;
      if (seen.has(uid)) {
        report.alreadyPresent += 1;
        continue;
      }
      seen.add(uid);
      const kind = typeof saved.kind === "string" ? saved.kind : "unknown";
      let outcome: RestoreOutcome;
      try {
        outcome =
          kind === "dom"
            ? restoreDomAnnotation(state, saved, uid)
            : kind === "text"
              ? restoreTextAnnotation(state, saved, uid)
              : kind === "screenshot"
                ? restoreScreenshotAnnotation(state, saved, uid)
                : { ok: false, reason: "unsupported_kind" };
      } catch (error) {
        outcome = {
          ok: false,
          reason: `restore_error: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
      const savedDisplayNumber =
        typeof saved.displayNumber === "number" ? saved.displayNumber : undefined;
      const comment = typeof saved.comment === "string" ? saved.comment : "";
      if (outcome.ok) {
        state.annotations.push(outcome.annotation);
        report.restored.push({
          uid,
          displayNumber: state.annotations.length,
          savedDisplayNumber,
          kind,
          comment,
          restoredBy: outcome.annotation.restoredBy ?? "coordinates",
        });
      } else {
        const selector =
          outcome.selector ?? (typeof saved.selector === "string" ? saved.selector : undefined);
        report.unrestored.push({
          uid,
          savedDisplayNumber,
          kind,
          comment,
          selector,
          text: typeof saved.text === "string" ? saved.text.slice(0, 180) : undefined,
          reason: outcome.reason,
        });
      }
    }
    const restored = report.restored.length;
    const unrestored = report.unrestored.length;
    report.status =
      restored > 0 && unrestored === 0
        ? "restored"
        : restored > 0
          ? "partial"
          : unrestored > 0
            ? "none_restored"
            : "already_present";
    return report;
  };

  const existingState = stateWindow.__abgAnnotationMode;
  const needsState =
    requestedAction === "start" ||
    requestedAction === "add_region" ||
    requestedAction === "add_selector" ||
    requestedAction === "restore";
  if (!existingState && !needsState) {
    return {
      ok: true,
      enabled: false,
      count: 0,
      annotations: [],
      nextCommand: "abg annotate <tab>",
    };
  }
  const state = existingState ?? createState();
  stateWindow.__abgAnnotationMode = state;
  state.selectedId ??= null;
  state.editGesture ??= null;
  state.suppressClickId ??= null;
  state.mode ??= "area";
  state.lastSelectionSignature ??= null;
  state.renderTimer ??= null;
  state.pageSessionId ??= makeUid();
  state.persist = requestedCommand.persist === true;
  for (const annotation of state.annotations) annotation.uid ??= makeUid();
  ensureRenderTimer(state);

  if (requestedAction === "start") setEnabled(state, true);
  if (requestedAction === "stop") setEnabled(state, false);
  if (requestedAction === "clear") {
    state.annotations = [];
    state.nextId = 1;
    state.selectedId = null;
    state.editGesture = null;
    closeEditor(state);
    renderAnnotations(state);
    reportAnnotationsChanged(state, true);
  }
  if (requestedAction === "add_region") {
    const { x, y, width, height } = requestedCommand;
    if (
      typeof x !== "number" ||
      typeof y !== "number" ||
      typeof width !== "number" ||
      typeof height !== "number" ||
      width < 1 ||
      height < 1
    ) {
      throw new Error("add_region requires x, y, width, and height");
    }
    addAutoAnnotation(
      state,
      {
        x,
        y,
        width,
        height,
      },
      {
        source: "cli",
        comment: requestedCommand.comment,
      },
    );
  }
  if (requestedAction === "add_selector") {
    const selector = requestedCommand.selector;
    if (!selector) throw new Error("add_selector requires selector");
    const element = document.querySelector(selector);
    if (!element) throw new Error(`selector not found: ${selector}`);
    const rect = rectForElement(element);
    addAnnotation(state, rect, {
      kind: "dom",
      source: "cli",
      selector,
      comment: requestedCommand.comment,
      element: metadataForElement(element),
    });
  }
  if (requestedAction === "list") renderAnnotations(state);
  let restoreReport: AnnotationRestoreReport | undefined;
  if (requestedAction === "restore") {
    restoreReport = restoreSavedAnnotations(
      state,
      Array.isArray(requestedCommand.saved) ? requestedCommand.saved : [],
    );
    renderAnnotations(state);
    if (restoreReport.restored.length > 0) reportAnnotationsChanged(state);
  }

  const result = makeResult(state, requestedAction);
  return restoreReport ? { ...result, restore: restoreReport } : result;
}

export async function manageAnnotationMode(
  tabId: number,
  command: AnnotationCommand,
): Promise<AnnotationModeResult> {
  try {
    const [res] = await browser.scripting.executeScript({
      target: { tabId },
      func: runAnnotationCommand,
      args: [withOverlayStrings({ ...command, persist: true })],
    });
    return normalizeAnnotationResult(res?.result);
  } catch (error) {
    if (!shouldFallbackToDebuggerRuntime(error)) throw error;
    return evaluateAnnotationModeWithDebugger(tabId, command);
  }
}

function withOverlayStrings(command: AnnotationCommand): InjectedAnnotationCommand {
  return { ...command, ui: command.ui ?? annotationOverlayStrings("en") };
}

function normalizeAnnotationResult(result: unknown): AnnotationModeResult {
  if (
    typeof result === "object" &&
    result !== null &&
    (result as { ok?: unknown }).ok === true &&
    typeof (result as { enabled?: unknown }).enabled === "boolean" &&
    typeof (result as { count?: unknown }).count === "number" &&
    Array.isArray((result as { annotations?: unknown }).annotations)
  ) {
    return result as AnnotationModeResult;
  }
  return {
    ok: true,
    enabled: false,
    count: 0,
    annotations: [],
    nextCommand: "abg annotate <tab>",
  };
}

function shouldFallbackToDebuggerRuntime(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("Cannot access contents of url") ||
    message.includes("Extension manifest must request permission to access this host")
  );
}

async function evaluateAnnotationModeWithDebugger(
  tabId: number,
  command: AnnotationCommand,
): Promise<AnnotationModeResult> {
  // The main world cannot reach the extension safely, so the overlay does not report changes
  // from here; the background still saves the annotations returned by each command.
  const commandSource = JSON.stringify(withOverlayStrings({ ...command, persist: false })).replace(
    /[<>&\u2028\u2029]/g,
    (char) => {
      const code = char.charCodeAt(0).toString(16).padStart(4, "0");
      return `\\u${code}`;
    },
  );
  const expression = `
    (() => {
      const runAnnotationCommand = ${runAnnotationCommand.toString()};
      return runAnnotationCommand(${commandSource});
    })()
  `;
  const evaluated = (await browser.debugger.sendCommand({ tabId }, "Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: false,
    userGesture: true,
  })) as {
    result?: { value?: unknown; description?: string };
    exceptionDetails?: { text?: string; exception?: { description?: string; value?: unknown } };
  };
  if (evaluated.exceptionDetails) {
    const details =
      evaluated.exceptionDetails.exception?.description ??
      String(evaluated.exceptionDetails.exception?.value ?? evaluated.exceptionDetails.text);
    throw new Error(details || "annotation runtime evaluation failed");
  }
  return normalizeAnnotationResult(evaluated.result?.value);
}
