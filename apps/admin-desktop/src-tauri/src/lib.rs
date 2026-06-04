use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::Manager;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Holds the spawned API child so we can kill it on app shutdown.
struct ApiProcess(Mutex<Option<Child>>);

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

/// Walks up from `start` looking for `apps/api/`. Returns the API package
/// root so the caller can derive `src/index.ts`, `node_modules/tsx`, etc.
fn find_monorepo_api_root(start: &Path) -> Option<PathBuf> {
    let mut cur = Some(start);
    while let Some(dir) = cur {
        let candidate = dir.join("apps/api");
        if candidate.join("src/index.ts").is_file() {
            return Some(candidate);
        }
        cur = dir.parent();
    }
    None
}

/// Resolved spawn target for the API.
///
/// Production ships a private Node runtime plus an esbuild bundle, so we run
/// `node.exe server.mjs`. In dev (monorepo) there is no bundle, so we fall
/// back to the system `node` running the tsx CLI against `src/index.ts` —
/// the api package's tsc output emits extensionless ESM imports Node won't
/// resolve, which is why we use tsx rather than a built `dist/index.js`.
struct ApiTarget {
    /// Executable to launch: the bundled private Node, or system `node` in dev.
    program: PathBuf,
    /// Args: `[server.mjs]` (bundled) or `[tsx_cli, src/index.ts]` (dev).
    args: Vec<PathBuf>,
    /// Working dir — the API writes `data/` and `tls/` relative to it, so it
    /// must be writable. In production this is the app-data dir, NOT the
    /// read-only resource dir.
    cwd: PathBuf,
    /// waiter-web `dist/`, served by the API at `/waiter`.
    waiter_dist: PathBuf,
    /// True for the shipped self-contained runtime (no `.env`), false in dev.
    /// Only the bundled runtime gets a generated, persisted JWT secret injected.
    bundled: bool,
}

#[cfg(target_os = "windows")]
const NODE_EXE: &str = "node.exe";
#[cfg(not(target_os = "windows"))]
const NODE_EXE: &str = "node";

/// Hex-encoded cryptographically random string of `bytes` bytes.
fn random_hex(bytes: usize) -> Option<String> {
    let mut buf = vec![0u8; bytes];
    getrandom::getrandom(&mut buf).ok()?;
    Some(buf.iter().map(|b| format!("{:02x}", b)).collect())
}

/// Returns a stable JWT secret for the bundled API, generating and persisting a
/// random one in the app-data dir on first run. Keeping it stable means tokens
/// survive app restarts; keeping it private/random means it isn't the insecure
/// dev default. Returns `None` only if app-data is unavailable or RNG fails, in
/// which case the API falls back to its own default.
fn ensure_jwt_secret(app: &tauri::AppHandle) -> Option<String> {
    let dir = app.path().app_data_dir().ok()?;
    let _ = std::fs::create_dir_all(&dir);
    let path = dir.join("jwt-secret");

    if let Ok(existing) = std::fs::read_to_string(&path) {
        let trimmed = existing.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }

    let secret = random_hex(48)?;
    std::fs::write(&path, &secret).ok()?;
    Some(secret)
}

/// Resolves how to launch the API. Lookup order:
///   1. Bundled runtime in the Tauri resource dir (`api/node.exe`,
///      `api/server.mjs`, `waiter/`) — the shipped, self-contained path.
///   2. `SERVA_API_ROOT` / `SERVA_WAITER_DIST` env vars (dev override).
///   3. Monorepo walk-up from the exe location (dev).
fn resolve_paths(app: &tauri::AppHandle) -> Option<ApiTarget> {
    // 1. Bundled self-contained runtime.
    if let Ok(resource_dir) = app.path().resource_dir() {
        let node = resource_dir.join("api").join(NODE_EXE);
        let server = resource_dir.join("api").join("server.mjs");
        let waiter = resource_dir.join("waiter");
        if node.is_file() && server.is_file() && waiter.is_dir() {
            // Writable working dir for the API's data/ and tls/ folders.
            let cwd = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| resource_dir.clone());
            let _ = std::fs::create_dir_all(&cwd);
            return Some(ApiTarget {
                program: node,
                args: vec![server],
                cwd,
                waiter_dist: waiter,
                bundled: true,
            });
        }
    }

    // Dev: system node + tsx against the TypeScript source.
    let dev_target = |api_root: PathBuf, waiter_dist: PathBuf| -> Option<ApiTarget> {
        let entry = api_root.join("src/index.ts");
        let tsx_cli = api_root.join("node_modules/tsx/dist/cli.mjs");
        if entry.is_file() && tsx_cli.is_file() && waiter_dist.is_dir() {
            Some(ApiTarget {
                program: PathBuf::from(NODE_EXE),
                args: vec![tsx_cli, entry],
                cwd: api_root,
                waiter_dist,
                bundled: false,
            })
        } else {
            None
        }
    };

    // 2. Explicit dev override.
    if let (Ok(root), Ok(waiter)) = (
        std::env::var("SERVA_API_ROOT"),
        std::env::var("SERVA_WAITER_DIST"),
    ) {
        if let Some(t) = dev_target(PathBuf::from(root), PathBuf::from(waiter)) {
            return Some(t);
        }
    }

    // 3. Monorepo walk-up.
    if let Ok(exe) = std::env::current_exe() {
        if let Some(api_root) = exe.parent().and_then(find_monorepo_api_root) {
            if let Some(waiter) = api_root.parent().map(|p| p.join("waiter-web/dist")) {
                if let Some(t) = dev_target(api_root, waiter) {
                    return Some(t);
                }
            }
        }
    }

    None
}

/// Spawns the Fastify API as a child process. Returns `Ok(None)` when the
/// API can't be located (the GUI still launches; the user can run the API
/// themselves and the admin will connect once it's reachable).
fn spawn_api(app: &tauri::AppHandle) -> Result<Option<Child>, std::io::Error> {
    let Some(target) = resolve_paths(app) else {
        eprintln!(
            "[serva] API not found — bundled runtime missing and no dev source located. The admin GUI will start without an embedded API."
        );
        return Ok(None);
    };

    let mut cmd = Command::new(&target.program);
    cmd.args(&target.args)
        .current_dir(&target.cwd)
        .env("WAITER_DIST_PATH", &target.waiter_dist)
        .env(
            "HOST",
            std::env::var("HOST").unwrap_or_else(|_| "0.0.0.0".into()),
        )
        .env(
            "PORT",
            std::env::var("PORT").unwrap_or_else(|_| "8787".into()),
        )
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());

    // The bundled runtime has no .env, so give it a stable, private JWT secret
    // (generated and persisted on first run) instead of the API's dev default.
    if target.bundled {
        if let Some(secret) = ensure_jwt_secret(app) {
            cmd.env("JWT_SECRET", secret);
        }
    }

    #[cfg(target_os = "windows")]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let args_display: Vec<String> = target
        .args
        .iter()
        .map(|a| a.display().to_string())
        .collect();
    println!(
        "[serva] starting API: {} {} (cwd={}, WAITER_DIST_PATH={})",
        target.program.display(),
        args_display.join(" "),
        target.cwd.display(),
        target.waiter_dist.display()
    );
    let child = cmd.spawn()?;
    Ok(Some(child))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(ApiProcess(Mutex::new(None)))
        .setup(|app| {
            // Force the window (and therefore the Windows taskbar entry) to use
            // the Serva brand icon. The executable's embedded resource icon can
            // lag behind the icons in `icons/` when the dev binary predates an
            // icon change, leaving the default Tauri logo in the taskbar.
            // Setting it explicitly at runtime makes the brand icon authoritative.
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_icon(tauri::include_image!("icons/128x128@2x.png"));
            }

            let handle = app.handle().clone();
            match spawn_api(&handle) {
                Ok(Some(child)) => {
                    let state = handle.state::<ApiProcess>();
                    *state.0.lock().unwrap() = Some(child);
                }
                Ok(None) => {}
                Err(err) => {
                    eprintln!("[serva] failed to spawn API: {err}");
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let state = window.app_handle().state::<ApiProcess>();
                let taken = state.0.lock().unwrap().take();
                if let Some(mut child) = taken {
                    let _ = child.kill();
                    let _ = child.wait();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
