export type CodeMirrorEditor = {
  getValue(): string;
  setValue(value: string): void;
  getOption(name: string): unknown;
};

// This function is serialized into ABG's existing page-world frame script.
// Resolve only the selected editor; never fall back to its hidden input buffer.
export function resolveCodeMirror(element: Element): CodeMirrorEditor | null {
  const wrapper = element.closest(".CodeMirror");
  if (!wrapper) return null;
  const editor = (wrapper as Element & { CodeMirror?: CodeMirrorEditor }).CodeMirror;
  if (
    !editor ||
    typeof editor.getValue !== "function" ||
    typeof editor.setValue !== "function" ||
    typeof editor.getOption !== "function"
  )
    return null;
  return editor;
}
