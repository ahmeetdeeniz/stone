use serde::{Deserialize, Serialize};
use std::{
    fs, io,
    path::{Component, Path, PathBuf},
    process::{Command, Output, Stdio},
    thread,
    time::Duration,
};
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    pub path: String,
    pub branch: Option<String>,
    pub is_dirty: bool,
    pub entries: Vec<String>,
    pub lfs: GitLfsInfo,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitLfsInfo {
    pub installed: bool,
    pub tracked_files: u32,
    pub warning: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitReview {
    pub status: GitStatus,
    pub staged: Vec<String>,
    pub diff_stat: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitOperationResult {
    pub output: String,
    pub warnings: Vec<String>,
}

#[derive(Debug)]
struct RunOutput {
    output: Output,
    cancelled: bool,
}

fn io_error(error: io::Error) -> String {
    if error.kind() == io::ErrorKind::NotFound {
        "Git bulunamadı. Windows için Git'i kurup tekrar deneyin.".to_owned()
    } else {
        error.to_string()
    }
}

fn askpass_file() -> Result<PathBuf, String> {
    let directory = std::env::temp_dir().join(format!("stone-git-{}", Uuid::new_v4()));
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let path = directory.join("askpass.cmd");
    fs::write(
        &path,
        "@echo off\r\necho %~1 | findstr /I \"Username\" >nul\r\nif not errorlevel 1 (echo x-access-token & exit /b 0)\r\necho %STONE_GITHUB_TOKEN%\r\n",
    )
    .map_err(|error| error.to_string())?;
    Ok(path)
}

fn run_git(
    args: &[String],
    cwd: Option<&Path>,
    access_token: Option<&str>,
    cancelled: Option<&dyn Fn() -> bool>,
) -> Result<RunOutput, String> {
    let askpass = access_token.map(|_| askpass_file()).transpose()?;
    let mut command = Command::new("git");
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("GIT_TERMINAL_PROMPT", "0");
    if let Some(directory) = cwd {
        command.current_dir(directory);
    }
    if let Some(token) = access_token {
        command.env("STONE_GITHUB_TOKEN", token);
        command.env(
            "GIT_ASKPASS",
            askpass.as_ref().expect("askpass path").as_os_str(),
        );
    }
    let mut child = command.spawn().map_err(io_error)?;
    let mut cancelled_run = false;
    loop {
        if cancelled.map(|check| check()).unwrap_or(false) {
            cancelled_run = true;
            let _ = child.kill();
            break;
        }
        if child
            .try_wait()
            .map_err(|error| error.to_string())?
            .is_some()
        {
            break;
        }
        thread::sleep(Duration::from_millis(100));
    }
    let output = child
        .wait_with_output()
        .map_err(|error| error.to_string())?;
    if let Some(path) = askpass {
        if let Some(directory) = path.parent() {
            let _ = fs::remove_dir_all(directory);
        }
    }
    Ok(RunOutput {
        output,
        cancelled: cancelled_run,
    })
}

fn text(output: &Output) -> String {
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    [stdout.trim(), stderr.trim()]
        .into_iter()
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

fn require_success(result: RunOutput) -> Result<String, String> {
    if result.cancelled {
        return Err("İşlem iptal edildi.".to_owned());
    }
    if !result.output.status.success() {
        return Err(text(&result.output));
    }
    Ok(text(&result.output))
}

fn require_repository(path: &str) -> Result<PathBuf, String> {
    let path =
        fs::canonicalize(path).map_err(|error| format!("Git klasörü bulunamadı: {error}"))?;
    if !path.is_dir() || !path.join(".git").exists() {
        return Err("Seçilen klasör bir Git repository değil.".to_owned());
    }
    Ok(path)
}

fn lfs_info(path: &Path) -> GitLfsInfo {
    let version = run_git(
        &["lfs".to_owned(), "version".to_owned()],
        Some(path),
        None,
        None,
    );
    if version.is_err()
        || !version
            .as_ref()
            .is_ok_and(|result| result.output.status.success())
    {
        return GitLfsInfo {
            installed: false,
            tracked_files: 0,
            warning: Some(
                "Git LFS kurulu değil; LFS dosyaları pointer olarak kalabilir.".to_owned(),
            ),
        };
    }
    let tracked = run_git(
        &["lfs".to_owned(), "ls-files".to_owned()],
        Some(path),
        None,
        None,
    )
    .ok()
    .map(|result| {
        String::from_utf8_lossy(&result.output.stdout)
            .lines()
            .count() as u32
    })
    .unwrap_or(0);
    GitLfsInfo {
        installed: true,
        tracked_files: tracked,
        warning: None,
    }
}

pub fn system_version() -> Result<String, String> {
    let result = run_git(&["--version".to_owned()], None, None, None)?;
    require_success(result)
}

pub fn status(path: String) -> Result<GitStatus, String> {
    let path = require_repository(&path)?;
    let output = require_success(run_git(
        &[
            "status".to_owned(),
            "--porcelain=v1".to_owned(),
            "--branch".to_owned(),
        ],
        Some(&path),
        None,
        None,
    )?)?;
    let mut lines = output.lines();
    let branch = lines
        .next()
        .and_then(|line| line.strip_prefix("## "))
        .map(|line| line.split("...").next().unwrap_or(line).to_owned());
    let entries = lines.map(str::to_owned).collect::<Vec<_>>();
    Ok(GitStatus {
        path: path.to_string_lossy().into_owned(),
        branch,
        is_dirty: !entries.is_empty(),
        entries,
        lfs: lfs_info(&path),
    })
}

pub fn review(path: String) -> Result<GitReview, String> {
    let path = require_repository(&path)?;
    let status = status(path.to_string_lossy().into_owned())?;
    let staged = require_success(run_git(
        &[
            "diff".to_owned(),
            "--cached".to_owned(),
            "--name-status".to_owned(),
        ],
        Some(&path),
        None,
        None,
    )?)?;
    let diff_stat = require_success(run_git(
        &[
            "diff".to_owned(),
            "--cached".to_owned(),
            "--stat".to_owned(),
        ],
        Some(&path),
        None,
        None,
    )?)?;
    Ok(GitReview {
        status,
        staged: staged.lines().map(str::to_owned).collect(),
        diff_stat,
    })
}

pub fn pull(path: String, access_token: &str) -> Result<GitOperationResult, String> {
    let path = require_repository(&path)?;
    let current = status(path.to_string_lossy().into_owned())?;
    if current.is_dirty {
        return Err("Yerel değişiklikler varken güvenli pull yapılamaz; önce değişiklikleri gözden geçirin.".to_owned());
    }
    let output = require_success(run_git(
        &["pull".to_owned(), "--ff-only".to_owned()],
        Some(&path),
        Some(access_token),
        None,
    )?)?;
    Ok(GitOperationResult {
        output,
        warnings: Vec::new(),
    })
}

fn safe_full_name(full_name: &str) -> Result<(&str, &str), String> {
    let mut parts = full_name.split('/');
    let owner = parts
        .next()
        .ok_or_else(|| "GitHub repository adı geçersiz.".to_owned())?;
    let name = parts
        .next()
        .ok_or_else(|| "GitHub repository adı geçersiz.".to_owned())?;
    if parts.next().is_some() || owner.is_empty() || name.is_empty() {
        return Err("GitHub repository adı owner/name biçiminde olmalı.".to_owned());
    }
    for value in [owner, name] {
        if value == "." || value == ".." || value.contains('\\') || value.contains(':') {
            return Err("GitHub repository adı güvenli değil.".to_owned());
        }
    }
    Ok((owner, name))
}

fn available_space(path: &Path) -> Result<u64, String> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
        let mut wide = path.as_os_str().encode_wide().collect::<Vec<_>>();
        wide.push(0);
        let mut free = 0u64;
        let result = unsafe {
            GetDiskFreeSpaceExW(
                wide.as_ptr(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                &mut free,
            )
        };
        if result == 0 {
            return Err("Disk alanı kontrol edilemedi.".to_owned());
        }
        Ok(free)
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        Err("Disk alanı kontrolü yalnızca Windows native uygulamasında kullanılabilir.".to_owned())
    }
}

pub fn check_space(root: &str, required_bytes: u64) -> Result<u64, String> {
    let path = PathBuf::from(root);
    fs::create_dir_all(&path).map_err(|error| error.to_string())?;
    let free = available_space(&path)?;
    if free < required_bytes {
        return Err(format!(
            "Yetersiz disk alanı: yaklaşık {required_bytes} byte gerekli, {free} byte boş."
        ));
    }
    Ok(free)
}

pub fn clone_repository(
    root: &str,
    full_name: &str,
    size_kb: u64,
    access_token: &str,
    cancelled: &dyn Fn() -> bool,
) -> Result<GitOperationResult, String> {
    let (_, name) = safe_full_name(full_name)?;
    let root = PathBuf::from(root);
    fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    let destination = root.join(name);
    if destination.exists() {
        return Err(format!("Hedef klasör zaten var: {}", destination.display()));
    }
    let estimated = size_kb
        .saturating_mul(1024)
        .saturating_mul(2)
        .max(50 * 1024 * 1024);
    check_space(root.to_string_lossy().as_ref(), estimated)?;
    let output = require_success(run_git(
        &[
            "clone".to_owned(),
            "--".to_owned(),
            format!("https://github.com/{full_name}.git"),
            destination.to_string_lossy().into_owned(),
        ],
        None,
        Some(access_token),
        Some(cancelled),
    )?)?;
    let mut warnings = Vec::new();
    if size_kb > 1_000_000 {
        warnings
            .push("Repository büyük; clone süresi ve disk kullanımı yüksek olabilir.".to_owned());
    }
    if !lfs_info(&destination).installed {
        warnings.push(
            "Git LFS kurulu değil; LFS dosyaları için ayrıca kurulum gerekebilir.".to_owned(),
        );
    }
    Ok(GitOperationResult { output, warnings })
}

pub fn stage_commit_push(
    path: String,
    paths: Vec<String>,
    message: String,
    access_token: &str,
) -> Result<GitOperationResult, String> {
    let path = require_repository(&path)?;
    let message = message.trim();
    if message.is_empty() || message.len() > 200 {
        return Err("Commit mesajı 1-200 karakter arasında olmalı.".to_owned());
    }
    if paths.is_empty() {
        return Err("Commit için en az bir dosya seçin.".to_owned());
    }
    let mut args = vec!["add".to_owned(), "--".to_owned()];
    for value in paths {
        let candidate = Path::new(&value);
        if candidate.is_absolute()
            || candidate
                .components()
                .any(|part| part == Component::ParentDir)
        {
            return Err("Stage yolu repository dışına çıkamaz.".to_owned());
        }
        args.push(value);
    }
    require_success(run_git(&args, Some(&path), None, None)?)?;
    require_success(run_git(
        &["commit".to_owned(), "-m".to_owned(), message.to_owned()],
        Some(&path),
        None,
        None,
    )?)?;
    let output = require_success(run_git(
        &["push".to_owned()],
        Some(&path),
        Some(access_token),
        None,
    )?)?;
    Ok(GitOperationResult {
        output,
        warnings: Vec::new(),
    })
}
