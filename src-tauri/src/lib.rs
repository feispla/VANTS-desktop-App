use keyring::{Entry, Error as KeyringError};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Emitter, Manager, WindowEvent};
use tauri_plugin_sql::{Migration, MigrationKind};
use uuid::Uuid;

#[cfg(any(target_os = "linux", all(debug_assertions, target_os = "windows")))]
use tauri_plugin_deep_link::DeepLinkExt;

const KEYRING_SERVICE: &str = "com.feispla.vantcall.desktop";
const KEYRING_USER: &str = "stronghold-vault-password";

#[tauri::command]
fn get_or_create_vault_password() -> Result<String, String> {
    let entry = Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .map_err(|error| format!("No se pudo abrir el almacén seguro del sistema: {error}"))?;

    match entry.get_password() {
        Ok(password) => Ok(password),
        Err(KeyringError::NoEntry) => {
            let password = Uuid::new_v4().to_string();
            entry.set_password(&password).map_err(|error| {
                format!(
                    "No se pudo guardar la clave de Stronghold en el llavero del sistema: {error}"
                )
            })?;
            Ok(password)
        }
        Err(error) => Err(format!(
            "No se pudo leer la clave de Stronghold del llavero del sistema: {error}"
        )),
    }
}

fn create_system_tray(app: &tauri::App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Abrir VANTCALL", true, None::<&str>)?;
    let find_match = MenuItem::with_id(app, "find-match", "Buscar partida", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Salir", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &find_match, &separator, &quit])?;
    let icon = app
        .default_window_icon()
        .cloned()
        .expect("Falta el icono predeterminado definido en tauri.conf.json");

    TrayIconBuilder::new()
        .icon(icon)
        .tooltip("VANTCALL Desktop")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_main_window(app),
            "find-match" => {
                show_main_window(app);
                let _ = app.emit("tray-action", "find-match");
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;

    if let Some(window) = app.get_webview_window("main") {
        let app_handle = app.handle().clone();
        window.on_window_event(move |event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                if let Some(window) = app_handle.get_webview_window("main") {
                    let _ = window.hide();
                }
            }
        });
    }

    Ok(())
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![
        Migration {
            version: 1,
            description: "create_local_cache_and_settings",
            sql: include_str!("../migrations/001_initial.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "add_anonymous_analytics",
            sql: include_str!("../migrations/002_anonymous_analytics.sql"),
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            for arg in &args {
                if arg.starts_with("vants://") {
                    let _ = app.emit("deep-link-forwarded", arg.clone());
                }
            }
            show_main_window(app);
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_oauth::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:vantcall.sqlite", migrations)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![get_or_create_vault_password])
        .setup(|app| {
            let data_dir = app.path().app_local_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let salt_path = data_dir.join("stronghold.salt");
            app.handle()
                .plugin(tauri_plugin_stronghold::Builder::with_argon2(&salt_path).build())?;

            #[cfg(any(target_os = "linux", all(debug_assertions, target_os = "windows")))]
            app.deep_link().register_all()?;

            create_system_tray(app)?;

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while building VANTCALL Desktop");
}
