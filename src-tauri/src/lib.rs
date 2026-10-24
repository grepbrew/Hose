// API keys live in the macOS Keychain, never in a plain file.
use tauri::Manager;

const SERVICE: &str = "com.grepbrew.hose";

// "keys" holds all secrets as one JSON item; the rest are per-key items from older builds, read once to migrate.
const NAMES: [&str; 4] = ["keys", "runpod", "hf", "vllm"];

fn entry(name: &str) -> Result<keyring::Entry, String> {
    if !NAMES.contains(&name) {
        return Err(format!("unknown secret {name}"));
    }
    keyring::Entry::new(SERVICE, name).map_err(|e| e.to_string())
}

#[tauri::command]
fn secret_get(name: &str) -> Result<Option<String>, String> {
    match entry(name)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn secret_set(name: &str, value: &str) -> Result<(), String> {
    entry(name)?.set_password(value).map_err(|e| e.to_string())
}

#[tauri::command]
fn secret_delete(name: &str) -> Result<(), String> {
    match entry(name)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        // its init script opens target=_blank links (chat replies) in the default browser
        .plugin(tauri_plugin_opener::init())
        // chat history: hose.db in ~/Library/Application Support/com.grepbrew.hose (the schema lives in src/history.ts)
        .plugin(tauri_plugin_sql::Builder::default().build())
        .invoke_handler(tauri::generate_handler![secret_get, secret_set, secret_delete, save_image])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
