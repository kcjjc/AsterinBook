pub mod contracts;
#[cfg(feature = "desktop")]
pub mod desktop;
pub mod services;
pub mod storage;
#[cfg(feature = "desktop")]
pub fn run() {
    desktop::builder()
        .run(tauri::generate_context!())
        .expect("Unable to start AsterinBook");
}
