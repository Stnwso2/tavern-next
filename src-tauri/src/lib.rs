// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
const API_KEY_SERVICE: &str = "com.tavernnext.desktop";
const API_KEY_ACCOUNT: &str = "shared-api-key";

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn get_api_key() -> Result<Option<String>, String> {
    let entry = keyring::Entry::new(API_KEY_SERVICE, API_KEY_ACCOUNT)
        .map_err(|error| format!("无法访问 Windows 凭据管理器：{error}"))?;

    match entry.get_password() {
        Ok(api_key) => Ok(Some(api_key)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(format!("读取 API 密钥失败：{error}")),
    }
}

#[tauri::command]
fn save_api_key(api_key: String) -> Result<(), String> {
    let entry = keyring::Entry::new(API_KEY_SERVICE, API_KEY_ACCOUNT)
        .map_err(|error| format!("无法访问 Windows 凭据管理器：{error}"))?;
    let api_key = api_key.trim();

    if api_key.is_empty() {
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(format!("删除 API 密钥失败：{error}")),
        }
    } else {
        entry
            .set_password(api_key)
            .map_err(|error| format!("保存 API 密钥失败：{error}"))
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![greet, get_api_key, save_api_key])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
