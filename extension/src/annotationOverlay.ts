import type { AnnotationAction } from "./types.js";

export type AnnotationCommand = {
  action: AnnotationAction;
  selector?: string;
  comment?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
};

export type AnnotationModeResult = {
  ok: true;
  enabled: boolean;
  count: number;
  annotations: unknown[];
  userMessage?: string;
  nextCommand?: string;
};

function runAnnotationCommand(requestedCommand: AnnotationCommand): AnnotationModeResult {
  type Rect = { x: number; y: number; width: number; height: number };
  type ScrollAnchor =
    | { type: "window" }
    | { type: "frame"; selector: string }
    | { type: "element"; selector: string };
  type Annotation = {
    id: number;
    displayNumber?: number;
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
  };
  type WindowWithABGAnnotation = Window & { __abgAnnotationMode?: AnnotationState };

  const stateWindow = window as WindowWithABGAnnotation;
  const requestedAction = requestedCommand.action;

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
    const meaningfulElement = nearestMeaningfulElement(state, element);
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
  const makeResult = (state: AnnotationState, action: AnnotationAction): AnnotationModeResult => {
    const annotations = snapshotAnnotations(state);
    return {
      ok: true,
      enabled: state.enabled,
      count: annotations.length,
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
  const isTextEditingTarget = (target: EventTarget | null): boolean => {
    if (!(target instanceof Element)) return false;
    return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
  };
  const updateToolbar = (state: AnnotationState) => {
    state.toolbar.hidden = !state.enabled;
    const countEl = state.toolbar.querySelector("[data-count]");
    if (countEl) {
      countEl.textContent = `${state.annotations.length} annotation${state.annotations.length === 1 ? "" : "s"}`;
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
    const form = document.createElement("form");
    const input = document.createElement("input");
    const save = document.createElement("button");
    const remove = document.createElement("button");
    input.type = "text";
    input.placeholder = "Add a comment...";
    input.value = annotation.comment;
    save.type = "submit";
    save.textContent = "Save";
    remove.type = "button";
    remove.textContent = "Delete";
    form.append(input, save, remove);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      annotation.comment = input.value.trim();
      closeEditor(state);
      renderAnnotations(state);
    });
    remove.addEventListener("click", () => {
      state.annotations = state.annotations.filter((item) => item.id !== annotation.id);
      closeEditor(state);
      renderAnnotations(state);
    });
    state.editor.append(form);
    state.editor.hidden = false;
    const width = Math.min(360, Math.max(240, innerWidth - 24));
    const left = Math.min(Math.max(12, viewportRect.x), innerWidth - width - 12);
    const top =
      viewportRect.y + viewportRect.height + 12 < innerHeight - 56
        ? viewportRect.y + viewportRect.height + 12
        : Math.max(12, viewportRect.y - 56);
    state.editor.style.left = `${Math.round(left)}px`;
    state.editor.style.top = `${Math.round(top)}px`;
    state.editor.style.width = `${Math.round(width)}px`;
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
        const anchorRect = textRects[textRects.length - 1] ?? rect;
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
          piece.setAttribute("aria-label", `Annotation ${index + 1}`);
          setRectStyle(piece, textRect);
          group.append(piece);
        }
        badge.className = "abg-text-selection-badge";
        badge.textContent = String(index + 1);
        badge.style.left = `${Math.round(anchorRect.x + anchorRect.width - 10)}px`;
        badge.style.top = `${Math.round(anchorRect.y + anchorRect.height - 10)}px`;
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
      ]
        .filter(Boolean)
        .join(" ");
      box.dataset.id = String(annotation.id);
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
        closeEditor(state);
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
    state.enabled = enabled;
    if (!enabled) {
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
          .abg-toolbar {
            position: fixed;
            top: 12px;
            right: 12px;
            z-index: 2147483647;
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 7px 8px;
            border: 1px solid rgba(255, 255, 255, 0.18);
            border-radius: 8px;
            background: rgba(37, 31, 52, 0.92);
            box-shadow: 0 8px 28px rgba(0, 0, 0, 0.28);
            color: #f7eaff;
            font: 12px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            pointer-events: auto;
            user-select: none;
          }
          .abg-chip {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            color: #ffd6f9;
            font-weight: 650;
          }
          .abg-dot {
            width: 7px;
            height: 7px;
            border-radius: 999px;
            background: #ff69d7;
            box-shadow: 0 0 0 3px rgba(255, 105, 215, 0.18);
          }
          .abg-count {
            color: rgba(255, 255, 255, 0.72);
          }
          .abg-toolbar button,
          .abg-editor button {
            appearance: none;
            border: 1px solid rgba(255, 255, 255, 0.18);
            border-radius: 6px;
            padding: 5px 8px;
            background: rgba(255, 255, 255, 0.11);
            color: inherit;
            font: inherit;
            cursor: pointer;
          }
          .abg-toolbar button:hover,
          .abg-editor button:hover {
            background: rgba(255, 255, 255, 0.18);
          }
          .abg-toolbar button.abg-active {
            border-color: rgba(255, 255, 255, 0.42);
            background: rgba(255, 255, 255, 0.24);
            color: #ffffff;
          }
          .abg-draft,
          .abg-annotation-box {
            position: fixed;
            box-sizing: border-box;
            border: 2px solid #1d9bf0;
            background: rgba(29, 155, 240, 0.2);
            box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.25);
          }
          .abg-draft {
            z-index: 2147483646;
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
            background: rgba(29, 155, 240, 0.26);
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
            background: rgba(88, 166, 255, 0.52);
            box-shadow: inset 0 -1px 0 rgba(88, 166, 255, 0.68);
            pointer-events: auto;
            cursor: pointer;
          }
          .abg-text-selection-badge {
            position: fixed;
            z-index: 2147483647;
            width: 22px;
            min-width: 22px;
            height: 22px;
            border-radius: 999px;
            border: 2px solid #ffffff;
            background: #1d9bf0;
            color: #ffffff;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            font: 700 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            box-shadow: 0 2px 10px rgba(0, 0, 0, 0.28);
            pointer-events: auto;
            cursor: pointer;
          }
          .abg-text-selection-comment {
            position: fixed;
            z-index: 2147483647;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            border-radius: 6px;
            padding: 4px 6px;
            background: rgba(5, 18, 31, 0.82);
            color: #ffffff;
            font: 12px/1.25 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            pointer-events: auto;
            cursor: pointer;
          }
          .abg-text-selection-piece:hover,
          .abg-text-selection-selected .abg-text-selection-piece {
            background: rgba(88, 166, 255, 0.64);
          }
          .abg-text-selection-selected .abg-text-selection-piece {
            box-shadow:
              inset 0 0 0 1px rgba(255, 255, 255, 0.62),
              inset 0 -1px 0 rgba(88, 166, 255, 0.78);
          }
          .abg-annotation-selected {
            outline: 1px solid rgba(255, 255, 255, 0.75);
            outline-offset: 2px;
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
            width: 8px;
            height: 8px;
            border: 2px solid #ffffff;
            border-radius: 999px;
            background: #1d9bf0;
            box-shadow: 0 1px 6px rgba(0, 0, 0, 0.3);
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
            top: 0;
            left: calc(50% - 6px);
          }
          .abg-resize-s::after {
            bottom: 0;
            left: calc(50% - 6px);
          }
          .abg-resize-e::after {
            top: calc(50% - 6px);
            right: 0;
          }
          .abg-resize-w::after {
            top: calc(50% - 6px);
            left: 0;
          }
          .abg-resize-ne::after {
            top: 2px;
            right: 2px;
          }
          .abg-resize-se::after {
            right: 2px;
            bottom: 2px;
          }
          .abg-resize-sw::after {
            left: 2px;
            bottom: 2px;
          }
          .abg-resize-nw::after {
            top: 2px;
            left: 2px;
          }
          .abg-annotation-badge {
            position: absolute;
            right: -12px;
            bottom: -12px;
            min-width: 22px;
            height: 22px;
            border-radius: 999px;
            border: 2px solid #ffffff;
            background: #1d9bf0;
            color: #ffffff;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            font: 700 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            box-shadow: 0 2px 10px rgba(0, 0, 0, 0.28);
          }
          .abg-annotation-comment {
            position: absolute;
            left: 8px;
            bottom: 8px;
            max-width: calc(100% - 16px);
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            border-radius: 6px;
            padding: 4px 6px;
            background: rgba(5, 18, 31, 0.82);
            color: #ffffff;
            font: 12px/1.25 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          }
          .abg-editor {
            position: fixed;
            z-index: 2147483647;
            pointer-events: auto;
          }
          .abg-editor form {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 8px;
            border-radius: 8px;
            background: rgba(43, 43, 54, 0.96);
            box-shadow: 0 8px 28px rgba(0, 0, 0, 0.32);
          }
          .abg-editor input {
            min-width: 0;
            flex: 1;
            border: 0;
            border-radius: 6px;
            padding: 7px 9px;
            background: rgba(255, 255, 255, 0.12);
            color: #ffffff;
            outline: none;
            font: 13px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          }
          .abg-editor input::placeholder {
            color: rgba(255, 255, 255, 0.5);
          }
          .abg-editor button {
            color: #ffffff;
            white-space: nowrap;
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
    toolbar.innerHTML = `
          <span class="abg-chip"><span class="abg-dot"></span>Annotating</span>
          <button type="button" data-action="mode-area" data-mode="area" aria-pressed="true">Area</button>
          <button type="button" data-action="mode-text" data-mode="text" aria-pressed="false">Text</button>
          <span class="abg-count" data-count>0 annotations</span>
          <button type="button" data-action="clear">Clear</button>
          <button type="button" data-action="done">Done</button>
        `;
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
    };
    capture.addEventListener("mousedown", (event) => {
      if (!state.enabled || event.button !== 0) return;
      closeEditor(state);
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
      if (action === "clear") {
        state.annotations = [];
        state.nextId = 1;
        state.selectedId = null;
        state.editGesture = null;
        state.lastSelectionSignature = null;
        closeEditor(state);
        renderAnnotations(state);
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
        if (didMove) renderAnnotations(state);
        event.preventDefault();
        event.stopPropagation();
      },
      true,
    );
    addEventListener(
      "keydown",
      (event) => {
        if (event.key === "Escape" && state.enabled) setEnabled(state, false);
        if (
          (event.key === "Delete" || event.key === "Backspace") &&
          state.selectedId !== null &&
          !isTextEditingTarget(event.target)
        ) {
          state.annotations = state.annotations.filter((item) => item.id !== state.selectedId);
          state.selectedId = null;
          state.editGesture = null;
          closeEditor(state);
          renderAnnotations(state);
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

  const existingState = stateWindow.__abgAnnotationMode;
  const needsState =
    requestedAction === "start" ||
    requestedAction === "add_region" ||
    requestedAction === "add_selector";
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

  return makeResult(state, requestedAction);
}

export async function manageAnnotationMode(
  tabId: number,
  command: AnnotationCommand,
): Promise<AnnotationModeResult> {
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId },
      func: runAnnotationCommand,
      args: [command],
    });
    return normalizeAnnotationResult(res?.result);
  } catch (error) {
    if (!shouldFallbackToDebuggerRuntime(error)) throw error;
    return evaluateAnnotationModeWithDebugger(tabId, command);
  }
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
  const commandSource = JSON.stringify(command).replace(/[<>&\u2028\u2029]/g, (char) => {
    const code = char.charCodeAt(0).toString(16).padStart(4, "0");
    return `\\u${code}`;
  });
  const expression = `
    (() => {
      const runAnnotationCommand = ${runAnnotationCommand.toString()};
      return runAnnotationCommand(${commandSource});
    })()
  `;
  const evaluated = (await chrome.debugger.sendCommand({ tabId }, "Runtime.evaluate", {
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
