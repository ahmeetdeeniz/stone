use keyring::Entry;
use reqwest::{header, Client, Response};
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
    #[serde(rename(deserialize = "avatar_url", serialize = "avatarUrl"))]
    pub avatar_url: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitHubDeviceStart {
    #[serde(rename(deserialize = "device_code", serialize = "deviceCode"))]
    pub device_code: String,
    #[serde(rename(deserialize = "user_code", serialize = "userCode"))]
    pub user_code: String,
    #[serde(rename(deserialize = "verification_uri", serialize = "verificationUri"))]
    pub verification_uri: String,
    #[serde(rename(deserialize = "expires_in", serialize = "expiresIn"))]
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
    #[serde(rename(deserialize = "full_name", serialize = "fullName"))]
    pub full_name: String,
    pub private: bool,
    #[serde(rename(deserialize = "html_url", serialize = "htmlUrl"))]
    pub html_url: String,
    #[serde(rename(deserialize = "clone_url", serialize = "cloneUrl"))]
    pub clone_url: String,
    #[serde(rename(deserialize = "ssh_url", serialize = "sshUrl"))]
    pub ssh_url: String,
    #[serde(rename(deserialize = "size", serialize = "sizeKb"))]
    pub size_kb: u64,
    #[serde(rename(deserialize = "default_branch", serialize = "defaultBranch"))]
    pub default_branch: String,
    pub visibility: Option<String>,
    #[serde(rename(deserialize = "updated_at", serialize = "updatedAt"))]
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn github_wire_fields_deserialize_and_serialize_for_the_frontend() {
        let repository: GitHubRepository = serde_json::from_str(
            r#"{
              "id": 42,
              "name": "stone",
              "full_name": "owner/stone",
              "private": true,
              "html_url": "https://github.com/owner/stone",
              "clone_url": "https://github.com/owner/stone.git",
              "ssh_url": "git@github.com:owner/stone.git",
              "size": 2048,
              "default_branch": "main",
              "visibility": "private",
              "updated_at": "2026-07-26T00:00:00Z",
              "permissions": {"admin": true, "push": true, "pull": true}
            }"#,
        )
        .expect("GitHub snake_case repository payload should parse");
        assert_eq!(repository.full_name, "owner/stone");
        assert_eq!(repository.size_kb, 2048);
        let frontend = serde_json::to_value(repository).expect("frontend payload should serialize");
        assert_eq!(frontend["fullName"], "owner/stone");
        assert_eq!(frontend["sizeKb"], 2048);
        assert_eq!(frontend["defaultBranch"], "main");
    }

    #[test]
    fn device_flow_start_payload_maps_to_camel_case() {
        let start: GitHubDeviceStart = serde_json::from_str(
            r#"{
              "device_code": "device",
              "user_code": "ABCD-EFGH",
              "verification_uri": "https://github.com/login/device",
              "expires_in": 900,
              "interval": 5
            }"#,
        )
        .expect("GitHub device payload should parse");
        let frontend = serde_json::to_value(start).expect("frontend payload should serialize");
        assert_eq!(frontend["deviceCode"], "device");
        assert_eq!(
            frontend["verificationUri"],
            "https://github.com/login/device"
        );
        assert_eq!(frontend["expiresIn"], 900);
    }
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
struct DeviceTokenResponse {
    access_token: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
    interval: Option<u64>,
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

pub async fn repository(full_name: &str) -> Result<GitHubRepository, String> {
    let access_token = token()?.ok_or_else(|| "GitHub hesabı bağlı değil.".to_owned())?;
    let response = api_headers(
        json_client().get(format!("{API_BASE}/repos/{full_name}")),
        &access_token,
    )
    .send()
    .await
    .map_err(|error| format!("GitHub repository bilgisi alınamadı: {error}"))?;
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
        .form(&[("client_id", client_id), ("scope", "repo".to_owned())])
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
    if !response.status().is_success() {
        return Err(api_error(response).await);
    }
    let payload = response
        .json::<DeviceTokenResponse>()
        .await
        .map_err(|error| error.to_string())?;
    if let Some(access_token) = payload.access_token {
        keychain()?
            .set_password(&access_token)
            .map_err(|error| error.to_string())?;
        return Ok(GitHubDevicePoll {
            status: "authorized".to_owned(),
            interval: 5,
            account: Some(account(&json_client(), &access_token).await?),
        });
    }
    let error = payload
        .error
        .ok_or_else(|| "GitHub Device Flow yanıtı geçersiz.".to_owned())?;
    let status = match error.as_str() {
        "authorization_pending" => "pending",
        "slow_down" => "slow_down",
        "access_denied" => "denied",
        "expired_token" | "token_expired" => "expired",
        other => {
            return Err(format!(
                "GitHub Device Flow hatası: {}{}",
                other,
                payload
                    .error_description
                    .as_deref()
                    .map(|value| format!(" ({value})"))
                    .unwrap_or_default()
            ));
        }
    };
    Ok(GitHubDevicePoll {
        status: status.to_owned(),
        interval: payload.interval.unwrap_or(5),
        account: None,
    })
}

/// Page size is fixed at 50 in production. `STONE_GITHUB_PAGE_SIZE` only exists so the
/// opt-in live E2E verifier can force multiple live pages on accounts with few repositories;
/// it has no effect unless explicitly set.
fn page_size() -> String {
    std::env::var("STONE_GITHUB_PAGE_SIZE")
        .ok()
        .filter(|value| {
            value
                .parse::<u32>()
                .is_ok_and(|value| (1..=100).contains(&value))
        })
        .unwrap_or_else(|| "50".to_owned())
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
            ("per_page", page_size().as_str()),
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
