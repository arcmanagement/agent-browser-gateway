const keys: Record<string, [string, number]> = {
  Backspace: ["Backspace", 8],
  Tab: ["Tab", 9],
  Enter: ["Enter", 13],
  Shift: ["ShiftLeft", 16],
  Control: ["ControlLeft", 17],
  Alt: ["AltLeft", 18],
  Escape: ["Escape", 27],
  Space: ["Space", 32],
  " ": ["Space", 32],
  PageUp: ["PageUp", 33],
  PageDown: ["PageDown", 34],
  End: ["End", 35],
  Home: ["Home", 36],
  ArrowLeft: ["ArrowLeft", 37],
  ArrowUp: ["ArrowUp", 38],
  ArrowRight: ["ArrowRight", 39],
  ArrowDown: ["ArrowDown", 40],
  Insert: ["Insert", 45],
  Delete: ["Delete", 46],
  Meta: ["MetaLeft", 91],
};
const punctuation: Record<string, [string, number]> = {
  ";": ["Semicolon", 186],
  ":": ["Semicolon", 186],
  "=": ["Equal", 187],
  "+": ["Equal", 187],
  ",": ["Comma", 188],
  "<": ["Comma", 188],
  "-": ["Minus", 189],
  _: ["Minus", 189],
  ".": ["Period", 190],
  ">": ["Period", 190],
  "/": ["Slash", 191],
  "?": ["Slash", 191],
  "`": ["Backquote", 192],
  "~": ["Backquote", 192],
  "[": ["BracketLeft", 219],
  "{": ["BracketLeft", 219],
  "\\": ["Backslash", 220],
  "|": ["Backslash", 220],
  "]": ["BracketRight", 221],
  "}": ["BracketRight", 221],
  "'": ["Quote", 222],
  '"': ["Quote", 222],
};

export function keyboardEventBase(key: string, code: string | undefined, modifiers: string[]) {
  let mask = 0;
  for (const modifier of modifiers) {
    const name = modifier.toLowerCase();
    if (name === "alt") mask |= 1;
    else if (name === "ctrl") mask |= 2;
    else if (name === "cmd" || name === "meta") mask |= 4;
    else if (name === "shift") mask |= 8;
  }
  const named = keys[key] ?? punctuation[key];
  const character = /^[a-z]$/i.test(key)
    ? key.toUpperCase()
    : /^[0-9]$/.test(key)
      ? key
      : undefined;
  const functionKey = /^F([1-9]|1[0-9]|2[0-4])$/.exec(key);
  const resolvedCode =
    code ??
    named?.[0] ??
    (character ? (/^[A-Z]$/.test(character) ? `Key${character}` : `Digit${character}`) : key);
  // CodeMirror 5 and other legacy handlers use keyCode/which, not event.key.
  const windowsVirtualKeyCode =
    named?.[1] ??
    (character ? character.charCodeAt(0) : functionKey ? 111 + Number(functionKey[1]) : 0);
  return {
    key: key === "Space" ? " " : key,
    code: resolvedCode,
    modifiers: mask,
    windowsVirtualKeyCode,
  };
}
