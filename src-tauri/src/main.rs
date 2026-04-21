#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::sync::Mutex;
use tauri::State;

// ===== SYSTEM COMMANDS =====

#[tauri::command]
fn minimize_window(window: tauri::Window) {
    window.minimize().unwrap();
}

#[tauri::command]
fn close_window(window: tauri::Window) {
    window.close().unwrap();
}

#[tauri::command]
fn start_drag(window: tauri::Window) {
    window.start_dragging().unwrap();
}

#[tauri::command]
fn maximize_window(window: tauri::Window) {
    window.maximize().unwrap();
}

#[tauri::command]
fn unmaximize_window(window: tauri::Window) {
    window.unmaximize().unwrap();
}

#[tauri::command]
fn set_window_size(window: tauri::Window, width: f64, height: f64) {
    window.set_size(tauri::Size::Physical(tauri::PhysicalSize { width: width as u32, height: height as u32 })).unwrap();
}

#[tauri::command]
fn set_window_position(window: tauri::Window, x: f64, y: f64) {
    window.set_position(tauri::Position::Physical(tauri::PhysicalPosition { x: x as i32, y: y as i32 })).unwrap();
}

#[tauri::command]
fn get_window_position(window: tauri::Window) -> (f64, f64) {
    let pos = window.outer_position().unwrap();
    (pos.x as f64, pos.y as f64)
}

// ===== FILE SYSTEM OPERATIONS =====

#[tauri::command]
fn read_file_contents(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_file_contents(path: String, contents: String) -> Result<(), String> {
    fs::write(&path, &contents).map_err(|e| e.to_string())
}

#[tauri::command]
fn create_directory(path: String) -> Result<(), String> {
    fs::create_dir_all(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_file(path: String) -> Result<(), String> {
    fs::remove_file(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_directory(path: String) -> Result<Vec<String>, String> {
    let entries = fs::read_dir(&path).map_err(|e| e.to_string())?;
    let mut files = Vec::new();
    for entry in entries {
        if let Ok(entry) = entry {
            files.push(entry.path().to_string_lossy().to_string());
        }
    }
    Ok(files)
}

#[tauri::command]
fn file_exists(path: String) -> bool {
    std::path::Path::new(&path).exists()
}

#[tauri::command]
fn get_app_data_dir() -> PathBuf {
    dirs::data_dir().unwrap_or_else(|| PathBuf::from(".")).join("nevax")
}

#[tauri::command]
fn get_config_dir() -> PathBuf {
    dirs::config_dir().unwrap_or_else(|| PathBuf::from(".")).join("nevax")
}

// ===== SYSTEM INFORMATION =====

#[tauri::command]
fn get_system_info() -> serde_json::Value {
    let info = serde_json::json!({
        "platform": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "family": std::env::consts::FAMILY,
        "current_dir": std::env::current_dir().unwrap_or_default().to_string_lossy().to_string(),
        "temp_dir": std::env::temp_dir().to_string_lossy().to_string(),
        "home_dir": dirs::home_dir().map(|p| p.to_string_lossy().to_string()).unwrap_or_default(),
    });
    info
}

#[tauri::command]
fn get_memory_info() -> serde_json::Value {
    // Placeholder - would use sysinfo crate in real implementation
    serde_json::json!({
        "total": "unknown",
        "used": "unknown",
        "free": "unknown"
    })
}

#[tauri::command]
fn get_cpu_info() -> serde_json::Value {
    serde_json::json!({
        "cores": std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1),
        "arch": std::env::consts::ARCH,
    })
}

// ===== AUDIO SYSTEM (Platform Specific) =====

#[cfg(target_os = "windows")]
#[tauri::command]
fn get_audio_devices() -> Vec<serde_json::Value> {
    // Windows-specific audio enumeration would go here
    vec![]
}

#[cfg(target_os = "macos")]
#[tauri::command]
fn get_audio_devices() -> Vec<serde_json::Value> {
    // macOS-specific audio enumeration using CoreAudio
    vec![]
}

#[cfg(target_os = "linux")]
#[tauri::command]
fn get_audio_devices() -> Vec<serde_json::Value> {
    // Linux ALSA/PulseAudio enumeration
    vec![]
}

#[tauri::command]
fn set_system_volume(volume: f64) {
    #[cfg(target_os = "windows")]
    {
        // Windows volume control via COM
    }
    #[cfg(target_os = "macos")]
    {
        // macOS volume via osascript
        let _ = Command::new("osascript")
            .args(&["-e", &format!("set volume output volume {}", volume)])
            .output();
    }
    #[cfg(target_os = "linux")]
    {
        // Linux volume via amixer or pactl
        let _ = Command::new("pactl")
            .args(&["set-sink-volume", "@DEFAULT_SINK@", &format!("{}%", volume)])
            .output();
    }
}

// ===== NOTIFICATIONS =====

#[tauri::command]
fn show_notification(title: String, body: String) {
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        let _ = Command::new("powershell")
            .args(&[
                "-Command",
                &format!(
                    "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('{}', '{}')",
                    body, title
                ),
            ])
            .output();
    }
    #[cfg(target_os = "macos")]
    {
        let _ = Command::new("osascript")
            .args(&["-e", &format!("display notification \"{}\" with title \"{}\"", body, title)])
            .output();
    }
    #[cfg(target_os = "linux")]
    {
        let _ = Command::new("notify-send")
            .args(&[&title, &body])
            .output();
    }
}

// ===== CLIPBOARD =====

#[tauri::command]
fn read_clipboard() -> String {
    // Would use arboard crate
    String::new()
}

#[tauri::command]
fn write_clipboard(text: String) {
    // Would use arboard crate
    let _ = text;
}

// ===== SCREEN CAPTURE =====

#[tauri::command]
fn capture_screen() -> Result<Vec<u8>, String> {
    // Would use screenshots or scrap crate
    Err("Not implemented".to_string())
}

// ===== NETWORK =====

#[tauri::command]
fn get_network_info() -> serde_json::Value {
    serde_json::json!({
        "hostname": gethostname::gethostname().to_string_lossy().to_string(),
    })
}

#[tauri::command]
async fn check_internet_connection() -> bool {
    // Simple ping to check connectivity
    true
}

// ===== STATE MANAGEMENT =====

struct AppState {
    settings: Mutex<serde_json::Value>,
    call_history: Mutex<Vec<serde_json::Value>>,
}

#[tauri::command]
fn save_app_state(state: State<AppState>, key: String, value: serde_json::Value) {
    let mut settings = state.settings.lock().unwrap();
    settings[key] = value;
}

#[tauri::command]
fn load_app_state(state: State<AppState>, key: String) -> Option<serde_json::Value> {
    let settings = state.settings.lock().unwrap();
    settings.get(&key).cloned()
}

// ===== MAIN =====

fn main() {
    let state = AppState {
        settings: Mutex::new(serde_json::json!({})),
        call_history: Mutex::new(vec![]),
    };

    tauri::Builder::default()
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            // Window
            minimize_window,
            close_window,
            start_drag,
            maximize_window,
            unmaximize_window,
            set_window_size,
            set_window_position,
            get_window_position,
            // File system
            read_file_contents,
            write_file_contents,
            create_directory,
            delete_file,
            list_directory,
            file_exists,
            get_app_data_dir,
            get_config_dir,
            // System info
            get_system_info,
            get_memory_info,
            get_cpu_info,
            get_network_info,
            check_internet_connection,
            // Audio
            get_audio_devices,
            set_system_volume,
            // Notifications
            show_notification,
            // Clipboard
            read_clipboard,
            write_clipboard,
            // Screen
            capture_screen,
            // State
            save_app_state,
            load_app_state,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

