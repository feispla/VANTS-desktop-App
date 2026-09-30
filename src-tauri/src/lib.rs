use keyring::{Entry, Error as KeyringError};
use tauri::Manager;
use tauri_plugin_sql::{Migration, MigrationKind};
use uuid::Uuid;

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
            entry
                .set_password(&password)
                .map_err(|error| format!("No se pudo guardar la clave de Stronghold en el llavero del sistema: {error}"))?;
            Ok(password)
        }
        Err(error) => Err(format!("No se pudo leer la clave de Stronghold del llavero del sistema: {error}")),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![Migration {
        version: 1,
        description: "create_local_cache_and_settings",
        sql: include_str!("../migrations/001_initial.sql"),
        kind: MigrationKind::Up,
    }];

    tauri::Builder::default()
        .plugin(tauri_plugin_oauth::init())
        .plugin(tauri_plugin_opener::init())
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
            app.handle().plugin(
                tauri_plugin_stronghold::Builder::with_argon2(&salt_path).build(),
            )?;

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
