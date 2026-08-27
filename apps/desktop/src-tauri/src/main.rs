// Hindari jendela konsol tambahan di Windows saat rilis.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    proxius_desktop_lib::run()
}
