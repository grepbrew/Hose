// API keys live in the macOS Keychain, never in a plain file.
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![secret_get, secret_set, secret_delete])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
