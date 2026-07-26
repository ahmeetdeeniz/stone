use keyring::Entry;
use reqwest::{header, Client, Response, StatusCode};
use serde::{Deserialize, Serialize};

const API_BASE: &str = "https://api.github.com";
const DEVICE_CODE_URL: &str = "https://github.com/login/device/code";
const ACCESS_TOKEN_URL: &str = "https://github.com/login/oauth/access_token";
const API_VERSION: &str = "2026-03-10";
const KEYCHAIN_SERVICE: &str = "com.imtempra.stone.github";
const KEYCHAIN_ACCOUNT: &str = "github-user-access-token";

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitHubAccount {
    pub id: u64,
    pub login: String,
    pub name: Option<String>,
    pub avatar_url: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitHubDeviceStart {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: u64,
    pub interval: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitHubDevicePoll {
    pub status: String,
    pub interval: u64,
    pub account: Option<GitHubAccount>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitHubRepository {
    pub id: u64,
    pub name: String,
    pub full_name: String,
    pub private: bool,
    pub html_url: String,
    pub clone_url: String,
    pub ssh_url: String,
    pub size_kb: u64,
    pub default_branch: String,
    pub visibility: Option<String>,
    pub updated_at: String,
    pub permissions: Option<GitHubPermissions>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitHubPermissions {
    pub admin: bool,
    pub push: bool,
    pub pull: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitHubRepositoryPage {
    pub page: u32,
    pub repositories: Vec<GitHubRepository>,
    pub has_next: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
struct DeviceError {
    error: String,
    error_description: Option<String>,
    interval: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct DeviceToken {
    access_token: String,
}

fn keychain() -> Result<Entry, String> {
    Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT).map_err(|error| error.to_string())
}

pub fn token() -> Result<Option<String>, String> {
    match keychain()?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

pub fn disconnect() -> Result<(), String> {
    match keychain()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

fn json_client() -> Client {
    Client::builder()
        .user_agent("Stone Desktop/0.1 (+https://github.com/imtempra/stone)")
        .build()
        .expect("GitHub HTTP client must be constructible")
}

fn api_headers(request: reqwest::RequestBuilder, access_token: &str) -> reqwest::RequestBuilder {
    request
        .header(header::ACCEPT, "application/vnd.github+json")
        .header("X-GitHub-Api-Version", API_VERSION)
        .bearer_auth(access_token)
}

async fn api_error(response: Response) -> String {
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if body.is_empty() {
        format!("GitHub API hatası ({status}).")
    } else {
        format!("GitHub API hatası ({status}): {body}")
    }
}

async fn account(client: &Client, access_token: &str) -> Result<GitHubAccount, String> {
    let response = api_headers(client.get(format!("{API_BASE}/user")), access_token)
        .send()
        .await
        .map_err(|error| format!("GitHub bağlantısı başarısız: {error}"))?;
    if !response.status().is_success() {
        return Err(api_error(response).await);
    }
    response.json().await.map_err(|error| error.to_string())
}

pub async fn status() -> Result<Option<GitHubAccount>, String> {
    let Some(access_token) = token()? else {
        return Ok(None);
    };
    account(&json_client(), &access_token).await.map(Some)
}

pub async fn device_start(client_id: String) -> Result<GitHubDeviceStart, String> {
    if client_id.trim().is_empty() {
        return Err("VITE_GITHUB_CLIENT_ID yapılandırılmamış.".to_owned());
    }
    let response = json_client()
        .post(DEVICE_CODE_URL)
        .header(header::ACCEPT, "application/json")
        .form(&[("client_id", client_id), ("scope", "repo user:email")])
        .send()
        .await
        .map_err(|error| format!("GitHub Device Flow bağlantısı başarısız: {error}"))?;
    if !response.status().is_success() {
        return Err(api_error(response).await);
    }
    response.json().await.map_err(|error| error.to_string())
}

pub async fn device_poll(
    client_id: String,
    device_code: String,
) -> Result<GitHubDevicePoll, String> {
    let response = json_client()
        .post(ACCESS_TOKEN_URL)
        .header(header::ACCEPT, "application/json")
        .form(&[
            ("client_id", client_id),
            ("device_code", device_code),
            (
                "grant_type",
                "urn:ietf:params:oauth:grant-type:device_code".to_owned(),
            ),
        ])
        .send()
        .await
        .map_err(|error| format!("GitHub Device Flow bağlantısı başarısız: {error}"))?;
    if response.status() == StatusCode::OK {
        let access = response
            .json::<DeviceToken>()
            .await
            .map_err(|error| error.to_string())?;
        keychain()?
            .set_password(&access.access_token)
            .map_err(|error| error.to_string())?;
        return Ok(GitHubDevicePoll {
            status: "authorized".to_owned(),
            interval: 5,
            account: Some(account(&json_client(), &access.access_token).await?),
        });
    }
    let error = response
        .json::<DeviceError>()
        .await
        .map_err(|parse_error| parse_error.to_string())?;
    let status = match error.error.as_str() {
        "authorization_pending" => "pending",
        "slow_down" => "slow_down",
        "access_denied" => "denied",
        "expired_token" | "token_expired" => "expired",
        other => return Err(format!("GitHub Device Flow hatası: {other}")),
    };
    Ok(GitHubDevicePoll {
        status: status.to_owned(),
        interval: error.interval.unwrap_or(5),
        account: None,
    })
}

pub async fn repositories(page: u32) -> Result<GitHubRepositoryPage, String> {
    let access_token = token()?.ok_or_else(|| "GitHub hesabı bağlı değil.".to_owned())?;
    let page = page.max(1);
    let page_value = page.to_string();
    let response = api_headers(
        json_client().get(format!("{API_BASE}/user/repos")).query(&[
            ("visibility", "all"),
            ("affiliation", "owner,collaborator,organization_member"),
            ("sort", "updated"),
            ("direction", "desc"),
            ("per_page", "50"),
            ("page", page_value.as_str()),
        ]),
        &access_token,
    )
    .send()
    .await
    .map_err(|error| format!("GitHub repository listesi alınamadı: {error}"))?;
    if !response.status().is_success() {
        return Err(api_error(response).await);
    }
    let has_next = response
        .headers()
        .get(header::LINK)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.split(',').any(|part| part.contains("rel=\"next\"")))
        .unwrap_or(false);
    let repositories = response
        .json::<Vec<GitHubRepository>>()
        .await
        .map_err(|error| error.to_string())?;
    Ok(GitHubRepositoryPage {
        page,
        repositories,
        has_next,
    })
}
