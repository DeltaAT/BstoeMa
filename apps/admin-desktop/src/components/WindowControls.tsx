import { getCurrentWindow } from "@tauri-apps/api/window";

interface Props {
  className?: string;
}

/**
 * Windows-style close / minimise / maximise buttons.
 * Handlers are wrapped in try/catch so the component silently no-ops
 * when running in a plain browser without the Tauri shell.
 */
export function WindowControls({ className }: Props) {
  async function handleMinimize() {
    try { await getCurrentWindow().minimize(); } catch {}
  }

  async function handleMaximize() {
    try {
      const win = getCurrentWindow();
      (await win.isMaximized()) ? await win.unmaximize() : await win.maximize();
    } catch {}
  }

  async function handleClose() {
    try { await getCurrentWindow().close(); } catch {}
  }

  return (
    <div className={`window-controls${className ? ` ${className}` : ""}`}>
      <button className="wc-btn wc-minimize" onClick={handleMinimize} title="Minimieren">
        <svg width="10" height="1" viewBox="0 0 10 1"><rect width="10" height="1" fill="currentColor"/></svg>
      </button>
      <button className="wc-btn wc-maximize" onClick={handleMaximize} title="Maximieren">
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor"/></svg>
      </button>
      <button className="wc-btn wc-close" onClick={handleClose} title="Schliessen">
        <svg width="10" height="10" viewBox="0 0 10 10"><line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" strokeWidth="1.2"/><line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" strokeWidth="1.2"/></svg>
      </button>
    </div>
  );
}
