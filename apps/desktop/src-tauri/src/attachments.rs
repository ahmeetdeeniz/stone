//! Note attachments (images and PDFs) on desktop.
//!
//! Attachments are immutable files named after the SHA-256 of their bytes and referenced from
//! Markdown as `attachments/<sha256>.<ext>`, exactly like the mobile app (see
//! `packages/markdown/src/attachments.ts` and `storage.rules`). Local copies live in
//! `<app data>/attachments/`; Firebase Storage keeps them under `users/{uid}/attachments/`.

use std::fs;
use std::path::{Path, PathBuf};

use reqwest::{Client, StatusCode};
use sha2::{Digest, Sha256};

pub const MAX_ATTACHMENT_BYTES: usize = 20 * 1024 * 1024;
const STORAGE_API: &str = "https://firebasestorage.googleapis.com/v0/b";
const LINK_PREFIX: &str = "](attachments/";

/// (canonical extension, MIME type) for every accepted extension, aliases included.
fn type_for_extension(extension: &str) -> Option<(&'static str, &'static str)> {
    match extension.to_ascii_lowercase().as_str() {
        "png" => Some(("png", "image/png")),
        "jpg" | "jpeg" => Some(("jpg", "image/jpeg")),
        "gif" => Some(("gif", "image/gif")),
        "webp" => Some(("webp", "image/webp")),
        "heic" | "heif" => Some(("heic", "image/heic")),
        "pdf" => Some(("pdf", "application/pdf")),
        _ => None,
    }
}

/// `<64 lowercase hex>.<canonical extension>`; anything else (paths, aliases) is rejected.
pub fn is_attachment_file_name(name: &str) -> bool {
    let Some((hash, extension)) = name.split_once('.') else {
        return false;
    };
    hash.len() == 64
        && hash
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        && type_for_extension(extension).is_some_and(|(canonical, _)| canonical == extension)
}

pub fn mime_type(file_name: &str) -> Option<&'static str> {
    if !is_attachment_file_name(file_name) {
        return None;
    }
    let extension = file_name.rsplit('.').next()?;
    type_for_extension(extension).map(|(_, mime)| mime)
}

pub fn is_image(file_name: &str) -> bool {
    mime_type(file_name).is_some_and(|mime| mime.starts_with("image/"))
}

/// Distinct attachment file names linked from a note, in order of first appearance.
pub fn referenced_attachments(markdown: &str) -> Vec<String> {
    let mut found = Vec::new();
    let mut rest = markdown;
    while let Some(index) = rest.find(LINK_PREFIX) {
        rest = &rest[index + LINK_PREFIX.len()..];
        let Some(end) = rest.find(')') else { break };
        let candidate = &rest[..end];
        if is_attachment_file_name(candidate) && !found.iter().any(|item| item == candidate) {
            found.push(candidate.to_owned());
        }
    }
    found
}

/// Validates and stores picked bytes under their content hash; returns the file name.
pub fn import_bytes(directory: &Path, original_name: &str, bytes: &[u8]) -> Result<String, String> {
    let extension = Path::new(original_name)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    let Some((canonical, _)) = type_for_extension(extension) else {
        return Err("Yalnızca görseller ve PDF dosyaları eklenebilir.".to_owned());
    };
    if bytes.is_empty() {
        return Err("Seçilen dosya boş.".to_owned());
    }
    if bytes.len() > MAX_ATTACHMENT_BYTES {
        return Err("Ekler en fazla 20 MB olabilir.".to_owned());
    }
    let file_name = format!("{:x}.{canonical}", Sha256::digest(bytes));
    let target = directory.join(&file_name);
    if !target.exists() {
        fs::create_dir_all(directory).map_err(|error| error.to_string())?;
        // Write to a temporary name first so a crash never leaves a truncated attachment
        // behind under its final (content-hash) name.
        let temporary = directory.join(format!(".{file_name}.partial"));
        fs::write(&temporary, bytes).map_err(|error| error.to_string())?;
        fs::rename(&temporary, &target).map_err(|error| error.to_string())?;
    }
    Ok(file_name)
}

pub fn local_path(directory: &Path, file_name: &str) -> Result<PathBuf, String> {
    if !is_attachment_file_name(file_name) {
        return Err("Geçersiz ek adı.".to_owned());
    }
    Ok(directory.join(file_name))
}

/// `users/{uid}/attachments/{file}` as one URL path segment (slashes encoded).
fn object_name(uid: &str, file_name: &str) -> Result<String, String> {
    if uid.is_empty() || !uid.bytes().all(|byte| byte.is_ascii_alphanumeric()) {
        return Err("Geçersiz kullanıcı kimliği.".to_owned());
    }
    if !is_attachment_file_name(file_name) {
        return Err("Geçersiz ek adı.".to_owned());
    }
    Ok(format!("users%2F{uid}%2Fattachments%2F{file_name}"))
}

pub fn bucket_or_default(bucket: Option<&str>, project_id: &str) -> String {
    match bucket.map(str::trim) {
        Some(value) if !value.is_empty() => value.trim_start_matches("gs://").to_owned(),
        _ => format!("{project_id}.firebasestorage.app"),
    }
}

pub enum StorageError {
    Offline,
    Failed(String),
}

async fn exists(
    client: &Client,
    bucket: &str,
    object: &str,
    id_token: &str,
) -> Result<bool, StorageError> {
    let response = client
        .get(format!("{STORAGE_API}/{bucket}/o/{object}"))
        .header("Authorization", format!("Firebase {id_token}"))
        .send()
        .await
        .map_err(|_| StorageError::Offline)?;
    match response.status() {
        status if status.is_success() => Ok(true),
        StatusCode::NOT_FOUND => Ok(false),
        status => Err(StorageError::Failed(format!("Firebase Storage: {status}"))),
    }
}

/// Uploads one attachment unless the bucket already has it (objects are immutable).
pub async fn upload(
    client: &Client,
    bucket: &str,
    uid: &str,
    file_name: &str,
    bytes: Vec<u8>,
    id_token: &str,
) -> Result<(), StorageError> {
    let object = object_name(uid, file_name).map_err(StorageError::Failed)?;
    let mime = mime_type(file_name).ok_or_else(|| StorageError::Failed("Geçersiz ek.".into()))?;
    if exists(client, bucket, &object, id_token).await? {
        return Ok(());
    }
    let response = client
        .post(format!(
            "{STORAGE_API}/{bucket}/o?uploadType=media&name={object}"
        ))
        .header("Authorization", format!("Firebase {id_token}"))
        .header("Content-Type", mime)
        .body(bytes)
        .send()
        .await
        .map_err(|_| StorageError::Offline)?;
    if response.status().is_success() {
        return Ok(());
    }
    // Another device may have created the same object in between; that is the same file.
    if exists(client, bucket, &object, id_token).await? {
        return Ok(());
    }
    Err(StorageError::Failed(format!(
        "Firebase Storage: {}",
        response.status()
    )))
}

pub async fn download(
    client: &Client,
    bucket: &str,
    uid: &str,
    file_name: &str,
    id_token: &str,
    target: &Path,
) -> Result<(), StorageError> {
    let object = object_name(uid, file_name).map_err(StorageError::Failed)?;
    let response = client
        .get(format!("{STORAGE_API}/{bucket}/o/{object}?alt=media"))
        .header("Authorization", format!("Firebase {id_token}"))
        .send()
        .await
        .map_err(|_| StorageError::Offline)?;
    if !response.status().is_success() {
        return Err(StorageError::Failed(format!(
            "Firebase Storage: {}",
            response.status()
        )));
    }
    let bytes = response.bytes().await.map_err(|_| StorageError::Offline)?;
    if bytes.is_empty() || bytes.len() > MAX_ATTACHMENT_BYTES {
        return Err(StorageError::Failed("Ek boyutu geçersiz.".to_owned()));
    }
    // Content addressing lets us verify the download against its own name.
    let expected = file_name.split('.').next().unwrap_or_default();
    if format!("{:x}", Sha256::digest(&bytes)) != expected {
        return Err(StorageError::Failed("İndirilen ek bozuk.".to_owned()));
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| StorageError::Failed(error.to_string()))?;
    }
    let temporary = target.with_extension("partial");
    fs::write(&temporary, &bytes).map_err(|error| StorageError::Failed(error.to_string()))?;
    fs::rename(&temporary, target).map_err(|error| StorageError::Failed(error.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    const HASH: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    #[test]
    fn validates_content_addressed_names() {
        assert!(is_attachment_file_name(&format!("{HASH}.png")));
        assert!(is_attachment_file_name(&format!("{HASH}.pdf")));
        assert!(!is_attachment_file_name(&format!("{HASH}.jpeg")));
        assert!(!is_attachment_file_name(&format!(
            "{}.png",
            HASH.to_uppercase()
        )));
        assert!(!is_attachment_file_name("../secret.png"));
        assert!(!is_attachment_file_name(&format!("{HASH}.svg")));
        assert_eq!(mime_type(&format!("{HASH}.jpg")), Some("image/jpeg"));
        assert!(is_image(&format!("{HASH}.webp")));
        assert!(!is_image(&format!("{HASH}.pdf")));
    }

    #[test]
    fn finds_referenced_attachments_once() {
        let markdown = format!(
            "![a](attachments/{HASH}.png)\n[b](attachments/{HASH}.png) [c](attachments/x.png)\n[d](attachments/{HASH}.pdf)"
        );
        assert_eq!(
            referenced_attachments(&markdown),
            vec![format!("{HASH}.png"), format!("{HASH}.pdf")]
        );
    }

    #[test]
    fn imports_bytes_under_their_hash() {
        let directory =
            std::env::temp_dir().join(format!("stone-attachments-{}", uuid::Uuid::new_v4()));
        let name = import_bytes(&directory, "Foto.JPEG", b"hello").unwrap();
        assert_eq!(
            name,
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824.jpg"
        );
        assert_eq!(fs::read(directory.join(&name)).unwrap(), b"hello");
        assert_eq!(
            import_bytes(&directory, "again.jpg", b"hello").unwrap(),
            name
        );
        assert!(import_bytes(&directory, "doc.docx", b"x").is_err());
        assert!(import_bytes(&directory, "empty.png", b"").is_err());
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn builds_owner_scoped_object_names_and_buckets() {
        assert_eq!(
            object_name("abc123", &format!("{HASH}.png")).unwrap(),
            format!("users%2Fabc123%2Fattachments%2F{HASH}.png")
        );
        assert!(object_name("a/b", &format!("{HASH}.png")).is_err());
        assert!(object_name("abc", "x.png").is_err());
        assert_eq!(bucket_or_default(None, "demo"), "demo.firebasestorage.app");
        assert_eq!(
            bucket_or_default(Some(" "), "demo"),
            "demo.firebasestorage.app"
        );
        assert_eq!(
            bucket_or_default(Some("gs://demo.appspot.com"), "demo"),
            "demo.appspot.com"
        );
    }
}
