export type AnnotationToolbarPreferences = { x: number; y: number; collapsed: boolean };

export const ANNOTATION_TOOLBAR_STORAGE_KEY = "annotationToolbarPreferences";

export function parseAnnotationToolbarPreferences(
  value: unknown,
): AnnotationToolbarPreferences | undefined {
  if (!value || typeof value !== "object") return undefined;
  const { x, y, collapsed } = value as Record<string, unknown>;
  if (
    typeof x !== "number" ||
    !Number.isFinite(x) ||
    x < 0 ||
    x > 1 ||
    typeof y !== "number" ||
    !Number.isFinite(y) ||
    y < 0 ||
    y > 1 ||
    typeof collapsed !== "boolean"
  )
    return undefined;
  return { x, y, collapsed };
}
