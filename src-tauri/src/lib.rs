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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        // its init script opens target=_blank links (chat replies) in the default browser
        .plugin(tauri_plugin_opener::init())
        // chat history: hose.db in ~/Library/Application Support/com.grepbrew.hose (the schema lives in src/history.ts)
        .plugin(tauri_plugin_sql::Builder::default().build())
        .invoke_handler(tauri::generate_handler![save_image])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
