// Pebble — a minimal AI overlay widget.
//
// The Rust side is intentionally small: it owns the OS-level global shortcut
// and hands everything else (positioning, sizing, streaming the model
// response) to the frontend, which talks to Groq directly over HTTPS.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

/// Finds every environment variable whose name starts with "GROQ_API_KEY"
/// — the bare name itself, or suffixed variants like "GROQ_API_KEY_1" or
/// "GROQ_API_KEY_BACKUP" — so the frontend can fall back from one to the
/// next if a key is invalid, rate-limited, or otherwise rejected. Sorted
/// for a stable, predictable order across runs.
#[derive(serde::Serialize)]
struct ApiKeyEntry {
    name: String,
    value: String,
}

#[tauri::command]
fn get_groq_keys() -> Vec<ApiKeyEntry> {
    let mut keys: Vec<ApiKeyEntry> = std::env::vars()
        .filter(|(name, _)| name.starts_with("GROQ_API_KEY"))
        .map(|(name, value)| ApiKeyEntry { name, value })
        .collect();
    keys.sort_by(|a, b| a.name.cmp(&b.name));
    keys
}

/// Opens a URL in the user's default browser — used for the GitHub link in
/// the info panel. Restricted to http(s) so this can't be turned into a way
/// to launch arbitrary local programs.
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    if !url.starts_with("https://") && !url.starts_with("http://") {
        return Err("Only http/https URLs are allowed.".to_string());
    }

    let spawn_result = if cfg!(target_os = "windows") {
        std::process::Command::new("cmd").args(["/C", "start", "", url.as_str()]).spawn()
    } else if cfg!(target_os = "macos") {
        std::process::Command::new("open").arg(url.as_str()).spawn()
    } else {
        std::process::Command::new("xdg-open").arg(url.as_str()).spawn()
    };

    spawn_result.map(|_| ()).map_err(|e| e.to_string())
}

/// Exposes the current app version (from Cargo.toml) to the frontend so the
/// updater UI can display it without hard-coding it.
#[tauri::command]
fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if shortcut.matches(Modifiers::ALT, Code::Space)
                        && event.state == ShortcutState::Pressed
                    {
                        if let Some(window) = app.get_webview_window("main") {
                            // Let the frontend own the actual show/hide,
                            // positioning, and sizing logic — it already has
                            // to compute monitor geometry for streaming
                            // growth, so it's the single source of truth.
                            let _ = window.emit("toggle-widget", ());
                        }
                    }
                })
                .build(),
        )
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            app.global_shortcut()
                .register(Shortcut::new(Some(Modifiers::ALT), Code::Space))?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_groq_keys, open_url, get_app_version])
        .run(tauri::generate_context!())
        .expect("error while running Pebble");
}
