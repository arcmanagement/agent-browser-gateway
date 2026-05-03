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

export async function manageAnnotationMode(
  tabId: number,
  command: AnnotationCommand,
): Promise<AnnotationModeResult> {
  const [res] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (requestedCommand: AnnotationCommand): AnnotationModeResult => {
      type Rect = { x: number; y: number; width: number; height: number };
      type ScrollAnchor =
        | { type: "window" }
        | { type: "frame"; selector: string }
        | { type: "element"; selector: string };
      type Annotation = {
        id: number;
        displayNumber?: number;
        kind: "screenshot" | "dom";
        source: "drag" | "cli";
        comment: string;
        selector?: string;
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
        const escaper = (globalThis as unknown as { CSS?: { escape?: (input: string) => string } })
          .CSS?.escape;
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
      const normalizeRect = (start: { x: number; y: number }, end: { x: number; y: number }) => {
        const x = Math.min(start.x, end.x);
        const y = Math.min(start.y, end.y);
        const width = Math.abs(end.x - start.x);
        const height = Math.abs(end.y - start.y);
        return { x, y, width, height };
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
      const selectorInfoFor = (
        el: Element,
      ): { selector: string; quality: "stable" | "structural" } => {
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
      const anchoredToViewportRect = (annotation: Annotation): Rect => {
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
      const isAlwaysScreenshotElement = (element: Element): boolean => {
        const tag = element.tagName.toLowerCase();
        return tag === "canvas" || tag === "video";
      };
      const isMediaElement = (element: Element): boolean => {
        const tag = element.tagName.toLowerCase();
        return tag === "svg" || tag === "img";
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
      const makeResult = (
        state: AnnotationState,
        action: AnnotationAction,
      ): AnnotationModeResult => {
        const annotations = snapshotAnnotations(state);
        return {
          ok: true,
          enabled: state.enabled,
          count: annotations.length,
          annotations,
          userMessage:
            action === "start"
              ? "Annotation mode is active. Drag on the page to mark regions; click Done or press Escape to stop capturing."
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
          const box = document.createElement("button");
          const badge = document.createElement("span");
          const comment = document.createElement("span");
          const handles = isSelected
            ? ["n", "ne", "e", "se", "s", "sw", "w", "nw"].map((handle) => {
                const el = document.createElement("span");
                el.className = `abg-resize-handle abg-resize-${handle}`;
                el.dataset.handle = handle;
                return el;
              })
            : [];
          box.type = "button";
          box.className = isSelected
            ? "abg-annotation-box abg-annotation-selected"
            : "abg-annotation-box";
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
        if (options.openEditor ?? annotation.comment.length === 0)
          editAnnotation(state, annotation);
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
      const setEnabled = (state: AnnotationState, enabled: boolean) => {
        state.enabled = enabled;
        state.capture.hidden = !enabled;
        state.capture.style.pointerEvents = enabled ? "auto" : "none";
        state.host.style.pointerEvents = enabled ? "auto" : "none";
        state.layer.style.pointerEvents = "none";
        if (!enabled) {
          state.dragStart = null;
          state.activeDraft = null;
          state.selectedId = null;
          state.editGesture = null;
          state.suppressClickId = null;
          state.draft.hidden = true;
          closeEditor(state);
          renderAnnotations(state);
          return;
        }
        updateToolbar(state);
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
            cursor: move;
            text-align: left;
          }
          .abg-annotation-box:hover {
            background: rgba(29, 155, 240, 0.26);
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
          <span class="abg-count" data-count>0 annotations</span>
          <button type="button" data-action="clear">Clear</button>
          <button type="button" data-action="done">Done</button>
        `;
        shadow.append(style, capture, layer, draft, editor, toolbar);
        document.documentElement.append(host);

        const state: AnnotationState = {
          enabled: false,
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
          if (action === "clear") {
            state.annotations = [];
            state.nextId = 1;
            state.selectedId = null;
            state.editGesture = null;
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
    },
    args: [command],
  });
  return (
    res?.result ?? {
      ok: true,
      enabled: false,
      count: 0,
      annotations: [],
      nextCommand: "abg annotate <tab>",
    }
  );
}
