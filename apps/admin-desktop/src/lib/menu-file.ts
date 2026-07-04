import { isTauri } from "@tauri-apps/api/core";

// Small cross-environment helpers for reading/writing a text file. In the
// packaged desktop app these go through the Tauri dialog + fs plugins; during
// `vite dev` (plain browser) they fall back to a download anchor / file input
// so the flow stays testable outside Tauri.

/** Saves `text` to a user-chosen path. Returns false if the user cancelled. */
export async function saveTextFile(
  defaultName: string,
  text: string,
  extension: string,
): Promise<boolean> {
  if (isTauri()) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const path = await save({
      defaultPath: defaultName,
      filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
    });
    if (!path) return false;
    const { writeTextFile } = await import("@tauri-apps/plugin-fs");
    await writeTextFile(path, text);
    return true;
  }

  // Browser fallback: trigger a download.
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = defaultName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return true;
}

/** Prompts for a file and returns its text, or null if the user cancelled. */
export async function openTextFile(extension: string): Promise<string | null> {
  if (isTauri()) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const path = await open({
      multiple: false,
      directory: false,
      filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
    });
    if (!path || typeof path !== "string") return null;
    const { readTextFile } = await import("@tauri-apps/plugin-fs");
    return readTextFile(path);
  }

  // Browser fallback: a hidden <input type="file">.
  return new Promise<string | null>((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = `.${extension}`;
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      file
        .text()
        .then((t) => resolve(t))
        .catch(() => resolve(null));
    };
    // If the picker is dismissed no change event fires; that just leaves the
    // promise pending, which is harmless (the caller's flow simply ends).
    input.click();
  });
}
