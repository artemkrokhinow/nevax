#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

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

fn main() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![minimize_window, close_window, start_drag])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

