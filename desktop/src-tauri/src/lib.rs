use std::fs;
use std::process::Command;
use if_addrs::{get_if_addrs, IfAddr};
use tauri::Manager;

const CONNECTOR_PORT: u16 = 8791;

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConnectorConfig { media_root: String, pairing_password: String }

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ConnectorSetup { media_root: String, password_configured: bool, public_base_url: String }

fn public_base_url() -> Result<String, String> {
    let address = get_if_addrs().map_err(|_| "Could not determine this computer's LAN address.".to_string())?
        .into_iter()
        .filter_map(|interface| match interface.addr {
            IfAddr::V4(address) if address.ip.is_private() && !matches!(address.ip.octets()[3], 0 | 255) => Some((interface.name, address.ip)),
            _ => None,
        })
        .filter(|(name, _)| !["bridge", "docker", "veth", "utun", "lo"].iter().any(|prefix| name.starts_with(prefix)))
        // Prefer common home-LAN subnets over container bridge networks.
        .max_by_key(|(name, address)| (
            if name.starts_with("en") { 1 } else { 0 },
            match address.octets() {
                [192, 168, ..] => 3,
                [172, second, ..] if (16..=31).contains(&second) => 2,
                [10, ..] => 1,
                _ => 0,
            },
        ))
        .map(|(_, address)| address)
        .ok_or_else(|| "Connect this computer to your home network first.".to_string())?;
    Ok(format!("http://{address}:{CONNECTOR_PORT}"))
}

fn connector_command(app: &tauri::AppHandle) -> Result<Command, String> {
    let resource_dir = app.path().resource_dir().map_err(|e| e.to_string())?.join("sidecar");
    let config = app.path().app_data_dir().map_err(|e| e.to_string())?.join("config.env");
    let mut command = Command::new(resource_dir.join("distribution-common/start-connector.sh"));
    command
        .env("CLEANFLIX_APP_ROOT", &resource_dir)
        .env("CLEANFLIX_CONFIG_PATH", config)
        .env("CLEANFLIX_NODE", resource_dir.join("node/bin/node"))
        // TVs discover the connector through an IPv4 LAN address.
        .env("HOST", "0.0.0.0")
        .env("PORT", CONNECTOR_PORT.to_string());
    Ok(command)
}

#[tauri::command]
fn pick_media_folder() -> Option<String> {
    rfd::FileDialog::new().pick_folder().map(|path| path.display().to_string())
}

#[tauri::command]
fn get_connector_setup(app: tauri::AppHandle) -> Result<ConnectorSetup, String> {
    let config = app.path().app_data_dir().map_err(|e| e.to_string())?.join("config.env");
    let content = fs::read_to_string(config).unwrap_or_default();
    let value = |key: &str| content.lines()
        .find_map(|line| line.strip_prefix(&format!("{key}=")))
        .unwrap_or_default()
        .to_string();
    Ok(ConnectorSetup {
        media_root: value("MEDIA_ROOT"),
        password_configured: !value("PAIRING_PASSWORD_HASH").is_empty(),
        public_base_url: value("PUBLIC_BASE_URL"),
    })
}

#[tauri::command]
fn get_cleanflix_link_url(app: tauri::AppHandle) -> Result<String, String> {
    let setup = get_connector_setup(app)?;
    if setup.media_root.is_empty() || !setup.password_configured {
        return Err("Save your media folder and pairing password before signing in.".into());
    }
    if setup.public_base_url.is_empty() { return Err("Start the connector before signing in.".into()); }
    Ok(format!("{}/account/link", setup.public_base_url))
}

#[tauri::command]
fn save_connector_config(app: tauri::AppHandle, config: ConnectorConfig) -> Result<(), String> {
    if config.media_root.trim().is_empty() {
        return Err("Choose a media folder.".into());
    }
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let config_path = dir.join("config.env");
    let existing = fs::read_to_string(&config_path).unwrap_or_default();
    let existing_hash = existing.lines().find_map(|line| line.strip_prefix("PAIRING_PASSWORD_HASH=")).unwrap_or_default();
    let resource_dir = app.path().resource_dir().map_err(|e| e.to_string())?.join("sidecar");
    let password_hash = if config.pairing_password.is_empty() {
        if existing_hash.is_empty() { return Err("Choose a password of at least 12 characters.".into()); }
        existing_hash.to_string()
    } else {
        if config.pairing_password.len() < 12 { return Err("Choose a password of at least 12 characters.".into()); }
        let hash = Command::new(resource_dir.join("node/bin/node"))
            .arg("hash-password.js")
            .arg(&config.pairing_password)
            .current_dir(&resource_dir)
            .output()
            .map_err(|_| "The bundled connector runtime is unavailable.".to_string())?;
        if !hash.status.success() { return Err("Could not secure the pairing password.".into()); }
        String::from_utf8(hash.stdout).map_err(|e| e.to_string())?.trim().to_string()
    };
    let public_base_url = public_base_url()?;
    let content = format!("MEDIA_ROOT={}\nPUBLIC_BASE_URL={}\nAPPROVAL_BASE_URL={}\nCLEANFLIX_API_URL=https://cleanflix.pro\nPAIRING_PASSWORD_HASH={}\n", config.media_root, public_base_url, public_base_url, password_hash);
    fs::write(config_path, content).map_err(|e| e.to_string())
}

#[tauri::command]
fn start_connector(app: tauri::AppHandle) -> Result<(), String> {
    connector_command(&app)?.spawn().map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![pick_media_folder, get_connector_setup, get_cleanflix_link_url, save_connector_config, start_connector])
        .setup(|app| {
            let config = app.path().app_data_dir()?.join("config.env");
            if config.exists() {
                let content = fs::read_to_string(&config)?;
                let mut updated = content.lines().map(|line| {
                    if line.starts_with("PUBLIC_BASE_URL=") || line.starts_with("APPROVAL_BASE_URL=") {
                        format!("{}={}",&line[..line.find('=').unwrap()], public_base_url().unwrap_or_else(|_| "http://cleanflix-connector.local:8787".into()))
                    } else { line.to_string() }
                }).collect::<Vec<_>>();
                if !updated.iter().any(|line| line.starts_with("CLEANFLIX_API_URL=")) {
                    updated.push("CLEANFLIX_API_URL=https://cleanflix.pro".into());
                }
                fs::write(&config, format!("{}\n", updated.join("\n")))?;
                connector_command(&app.handle()).map_err(std::io::Error::other)?.spawn()?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Tauri application");
}
