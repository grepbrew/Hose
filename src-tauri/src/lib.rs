// API keys live in the app's local storage (src/secrets.ts), not the Keychain: no Rust side.
mod relay;

use relay::Relay;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{Emitter, Manager};
use tauri_plugin_notification::NotificationExt;

// A picture from a picture pod: the PNG bytes as the raw IPC body, its file name in the `name` header.
// Saved in ~/Pictures/Hose; returns the full path for Show in Finder.
#[tauri::command]
fn save_image(app: tauri::AppHandle, request: tauri::ipc::Request<'_>) -> Result<String, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected the picture's bytes".into());
    };
    let name = request.headers().get("name").and_then(|v| v.to_str().ok()).unwrap_or("");
    // a bare file name only: nothing that climbs out of the folder
    if name.is_empty() || name.contains('/') || name.starts_with('.') {
        return Err(format!("bad file name {name:?}"));
    }
    let dir = app.path().picture_dir().map_err(|e| e.to_string())?.join("Hose");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(name);
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

/** The app pushes its routes (relayRoutes in cost.ts) on every change; an error says why the relay isn't listening. */
#[tauri::command]
fn relay_set(relay: tauri::State<'_, Arc<Relay>>, table: relay::Table) -> Result<(), String> {
    relay.set(table);
    let status = relay.status.lock().unwrap().clone();
    if status.is_empty() { Ok(()) } else { Err(status) }
}

fn home() -> PathBuf {
    std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default()
}

/** Hose's own setup file for a coding tool; their main settings files are never touched.
 * Claude Code reads it with `--settings`, Codex layers `<CODEX_HOME>/hose.config.toml` with `-p hose`. */
fn setup_file(home: &Path, codex_home: Option<PathBuf>, tool: &str) -> Option<PathBuf> {
    match tool {
        "claude" => Some(home.join(".claude/hose.json")),
        "codex" => Some(codex_home.unwrap_or_else(|| home.join(".codex")).join("hose.config.toml")),
        _ => None,
    }
}

fn setup_text(tool: &str, token: &str) -> String {
    let base = format!("http://127.0.0.1:{}", relay::PORT);
    if tool == "claude" {
        // ANTHROPIC_AUTH_TOKEN goes as a Bearer token, the only kind vLLM (and the relay) accept
        let env = serde_json::json!({ "env": { "ANTHROPIC_BASE_URL": base, "ANTHROPIC_AUTH_TOKEN": token } });
        return serde_json::to_string_pretty(&env).unwrap() + "\n";
    }
    format!(
        "# Written by Hose: `codex -p hose -m <name>` uses the models on your Hose pods.\n\
         model_provider = \"hose\"\n\n\
         [model_providers.hose]\n\
         name = \"Hose\"\n\
         base_url = \"{base}/v1\"\n\
         wire_api = \"responses\"\n\
         experimental_bearer_token = \"{token}\"\n"
    )
}

fn write_setup(home: &Path, codex_home: Option<PathBuf>, tool: &str, token: &str) -> Result<PathBuf, String> {
    let path = setup_file(home, codex_home, tool).ok_or(format!("unknown tool {tool:?}"))?;
    std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    std::fs::write(&path, setup_text(tool, token)).map_err(|e| e.to_string())?;
    Ok(path)
}

#[tauri::command]
fn setup_tool(tool: String, token: String) -> Result<String, String> {
    let path = write_setup(&home(), std::env::var_os("CODEX_HOME").map(PathBuf::from), &tool, &token)?;
    Ok(path.to_string_lossy().into_owned())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct Tools {
    claude: bool,
    codex: bool,
    claude_setup: bool,
    codex_setup: bool,
}

/** Which coding tools are installed, and which Hose has set up. An app opened from the Dock doesn't get the shell's
 * PATH, so a login shell is asked, then the folders their installers use. */
#[tauri::command]
async fn coding_tools() -> Tools {
    let home = home();
    let shell = std::process::Command::new("/bin/zsh")
        .args(["-lc", "command -v claude codex"])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
        .unwrap_or_default();
    let found = |name: &str| {
        shell.lines().any(|l| l.trim().ends_with(&format!("/{name}")))
            || [".local/bin", ".npm-global/bin", ".bun/bin"].iter().any(|d| home.join(d).join(name).exists())
            || ["/opt/homebrew/bin", "/usr/local/bin"].iter().any(|d| Path::new(d).join(name).exists())
    };
    let set_up = |tool: &str| setup_file(&home, std::env::var_os("CODEX_HOME").map(PathBuf::from), tool).is_some_and(|p| p.exists());
    Tools { claude: found("claude"), codex: found("codex"), claude_setup: set_up("claude"), codex_setup: set_up("codex") }
}

// Up to 0.2.2 the bundle id was another com.*.hose. macOS names the app's data folders after it:
// hose.db in Application Support, local storage (keys, saved models) in WebKit. Move them over once,
// before the webview opens, so an update keeps everything. Never overwrites the new folder.
// ponytail: matches any com.*.hose folder; delete once nobody updates from 0.2.2 or older
fn move_old_data(lib: &std::path::Path, id: &str) {
    for dir in ["Application Support", "WebKit"] {
        let new = lib.join(dir).join(id);
        let Ok(entries) = std::fs::read_dir(lib.join(dir)) else { continue };
        if new.exists() {
            continue;
        }
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with("com.") && name.ends_with(".hose") && name != id {
                let _ = std::fs::rename(entry.path(), &new);
                break;
            }
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let context = tauri::generate_context!();
    if let Some(home) = std::env::var_os("HOME") {
        move_old_data(&std::path::Path::new(&home).join("Library"), &context.config().identifier);
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_http::init())
        // its init script opens target=_blank links (chat replies) in the default browser
        .plugin(tauri_plugin_opener::init())
        // chat history: hose.db in ~/Library/Application Support/com.grepbrew.hose (the schema lives in src/history.ts)
        .plugin(tauri_plugin_sql::Builder::default().build())
        .setup(|app| {
            let (start, ready) = (app.handle().clone(), app.handle().clone());
            let relay = Arc::new(Relay::new(
                Box::new(|pod| relay::runpod(pod)),
                // the app turns the config on (fleet.ts), as its Turn on button does
                Box::new(move |key| drop(start.emit("relay-start", key))),
                Box::new(move |name| drop(ready.notification().builder().title("Hose").body(format!("{name} is ready")).show())),
            ));
            app.manage(relay.clone());
            tauri::async_runtime::spawn(async move {
                let res = match tokio::net::TcpListener::bind(("127.0.0.1", relay::PORT)).await {
                    Ok(listener) => relay::serve(relay.clone(), listener).await,
                    Err(e) => Err(e),
                };
                if let Err(e) = res {
                    *relay.status.lock().unwrap() = format!("Coding tools can't reach Hose: port {} is busy on this Mac ({e}).", relay::PORT);
                }
            });
            Ok(())
        })
        // closing the window hides Hose so the relay keeps answering coding tools; ⌘Q quits
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![save_image, relay_set, setup_tool, coding_tools])
        .build(context)
        .expect("error while building tauri application")
        .run(|app, event| {
            // a click on the Dock icon brings the hidden window back
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (app, event);
        });
}

#[cfg(test)]
mod tests {
    use super::{move_old_data, write_setup};
    use std::fs;

    fn library(name: &str) -> std::path::PathBuf {
        let lib = std::env::temp_dir().join(format!("hose-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&lib);
        lib
    }

    #[test]
    fn move_old_data_moves_old_folders() {
        let lib = library("move");
        fs::create_dir_all(lib.join("Application Support/com.old.hose")).unwrap();
        fs::write(lib.join("Application Support/com.old.hose/hose.db"), "chats").unwrap();
        fs::create_dir_all(lib.join("WebKit/com.old.hose")).unwrap();
        fs::write(lib.join("WebKit/com.old.hose/x"), "keys").unwrap();

        move_old_data(&lib, "com.grepbrew.hose");

        assert_eq!(fs::read_to_string(lib.join("Application Support/com.grepbrew.hose/hose.db")).unwrap(), "chats");
        assert_eq!(fs::read_to_string(lib.join("WebKit/com.grepbrew.hose/x")).unwrap(), "keys");
        assert!(!lib.join("Application Support/com.old.hose").exists());
        assert!(!lib.join("WebKit/com.old.hose").exists());
    }

    #[test]
    fn move_old_data_keeps_new_folder() {
        let lib = library("keep");
        fs::create_dir_all(lib.join("Application Support/com.old.hose")).unwrap();
        fs::write(lib.join("Application Support/com.old.hose/hose.db"), "old").unwrap();
        fs::create_dir_all(lib.join("Application Support/com.grepbrew.hose")).unwrap();
        fs::write(lib.join("Application Support/com.grepbrew.hose/hose.db"), "new").unwrap();

        move_old_data(&lib, "com.grepbrew.hose");

        assert_eq!(fs::read_to_string(lib.join("Application Support/com.grepbrew.hose/hose.db")).unwrap(), "new");
        assert_eq!(fs::read_to_string(lib.join("Application Support/com.old.hose/hose.db")).unwrap(), "old");
    }

    #[test]
    fn setup_files() {
        let home = library("setup");
        fs::create_dir_all(home.join(".codex")).unwrap();
        fs::write(home.join(".codex/config.toml"), "model = \"gpt-5\"\n").unwrap();

        let claude = write_setup(&home, None, "claude", "t1").unwrap();
        let codex = write_setup(&home, None, "codex", "t1").unwrap();

        assert_eq!(claude, home.join(".claude/hose.json"));
        let env: serde_json::Value = serde_json::from_str(&fs::read_to_string(&claude).unwrap()).unwrap();
        assert_eq!(env, serde_json::json!({ "env": { "ANTHROPIC_BASE_URL": "http://127.0.0.1:41180", "ANTHROPIC_AUTH_TOKEN": "t1" } }));
        assert_eq!(codex, home.join(".codex/hose.config.toml"));
        let toml = fs::read_to_string(&codex).unwrap();
        for line in ["model_provider = \"hose\"", "[model_providers.hose]", "base_url = \"http://127.0.0.1:41180/v1\"", "wire_api = \"responses\"", "experimental_bearer_token = \"t1\""] {
            assert!(toml.contains(line), "{line} missing from {toml}");
        }
        assert_eq!(fs::read_to_string(home.join(".codex/config.toml")).unwrap(), "model = \"gpt-5\"\n");
        assert!(write_setup(&home, None, "cursor", "t1").is_err());
    }
}
