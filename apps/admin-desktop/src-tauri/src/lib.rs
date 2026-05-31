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

/// Resolved spawn target for the API. We invoke Node directly with the tsx
/// CLI rather than a built `dist/index.js` because the api package's tsc
/// output emits extensionless ESM imports that Node won't resolve.
struct ApiTarget {
    api_root: PathBuf,
    entry: PathBuf,
    tsx_cli: PathBuf,
    waiter_dist: PathBuf,
}

/// Resolves the API package layout and the waiter-web `dist/` directory.
/// Lookup order:
///   1. `SERVA_API_ROOT` / `SERVA_WAITER_DIST` env vars (explicit override).
///   2. Tauri resource directory (`api/`, `waiter/`).
///   3. Monorepo walk-up from the exe location.
fn resolve_paths(app: &tauri::AppHandle) -> Option<ApiTarget> {
    let try_root = |api_root: PathBuf, waiter_dist: PathBuf| -> Option<ApiTarget> {
        let entry = api_root.join("src/index.ts");
        let tsx_cli = api_root.join("node_modules/tsx/dist/cli.mjs");
        if entry.is_file() && tsx_cli.is_file() && waiter_dist.is_dir() {
            Some(ApiTarget { api_root, entry, tsx_cli, waiter_dist })
        } else {
            None
        }
    };

    if let (Ok(root), Ok(waiter)) = (
        std::env::var("SERVA_API_ROOT"),
        std::env::var("SERVA_WAITER_DIST"),
    ) {
        if let Some(t) = try_root(PathBuf::from(root), PathBuf::from(waiter)) {
            return Some(t);
        }
    }

    if let Ok(resource_dir) = app.path().resource_dir() {
        if let Some(t) = try_root(resource_dir.join("api"), resource_dir.join("waiter")) {
            return Some(t);
        }
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(api_root) = exe.parent().and_then(find_monorepo_api_root) {
            let waiter = api_root
                .parent() // apps/
                .map(|p| p.join("waiter-web/dist"));
            if let Some(waiter) = waiter {
                if let Some(t) = try_root(api_root, waiter) {
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
            "[serva] API not found — set SERVA_API_ROOT + SERVA_WAITER_DIST or run `pnpm install` + `pnpm --filter waiter-web build`. The admin GUI will start without an embedded API."
        );
        return Ok(None);
    };

    let mut cmd = Command::new("node");
    cmd.arg(&target.tsx_cli)
        .arg(&target.entry)
        .current_dir(&target.api_root)
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

    #[cfg(target_os = "windows")]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    println!(
        "[serva] starting API: node {} {} (cwd={}, WAITER_DIST_PATH={})",
        target.tsx_cli.display(),
        target.entry.display(),
        target.api_root.display(),
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
