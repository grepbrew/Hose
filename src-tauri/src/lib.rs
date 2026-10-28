// API keys live in the app's local storage (src/secrets.ts), not the Keychain: no Rust side.
use tauri::Manager;

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
        .plugin(tauri_plugin_http::init())
        // its init script opens target=_blank links (chat replies) in the default browser
        .plugin(tauri_plugin_opener::init())
        // chat history: hose.db in ~/Library/Application Support/com.grepbrew.hose (the schema lives in src/history.ts)
        .plugin(tauri_plugin_sql::Builder::default().build())
        .invoke_handler(tauri::generate_handler![save_image])
        .run(context)
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::move_old_data;
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
}
