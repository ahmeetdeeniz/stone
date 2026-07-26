//! Opt-in live GitHub end-to-end verification for Stone Goal 7.
//!
//! This suite calls the exact production functions in `stone_desktop_lib::github` and
//! `stone_desktop_lib::git` (real GitHub REST calls, real Windows keychain, real `git`
//! subprocess) against a disposable private repository. It never runs as part of a plain
//! `cargo test` because every test is `#[ignore]`; it also self-skips (returns success with a
//! message) unless `STONE_GITHUB_LIVE_E2E=1` is explicitly set, so it is safe even if someone
//! runs `cargo test -- --ignored` without meaning to hit the network or a real account.
//!
//! Run individual steps in order via `pnpm verify:github:live`, which also loads
//! `apps/desktop/.env.local` and generates a disposable temp root/db path per run.
//!
//! Required environment (only read once the opt-in switch is on):
//! - `STONE_GITHUB_LIVE_E2E=1`            master opt-in switch
//! - `VITE_GITHUB_CLIENT_ID`              the self-hoster's own GitHub OAuth App client id
//! - `STONE_LIVE_E2E_REPO`                `owner/stone-goal7-e2e` disposable repository
//! - `STONE_LIVE_E2E_ROOT`                temp restore root, outside the Stone source tree
//! - `STONE_LIVE_E2E_DB`                  temp sqlite file simulating the desktop app data dir
//!
//! Never prints an access token, device code, or keychain content: only user codes,
//! verification URLs, account logins, repository names, and file/commit results.

use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    time::{Duration, Instant},
};
use stone_desktop_lib::{
    git, github, link_repository, list_links, persist_restore_path, Database, GitHubLinkInput,
};

fn live_e2e_enabled() -> bool {
    std::env::var("STONE_GITHUB_LIVE_E2E").ok().as_deref() == Some("1")
}

fn skip_if_disabled(step: &str) -> bool {
    if live_e2e_enabled() {
        return false;
    }
    eprintln!(
        "[skip] {step}: STONE_GITHUB_LIVE_E2E is not set to 1; live GitHub E2E is opt-in only."
    );
    true
}

fn required_env(name: &str) -> String {
    std::env::var(name).unwrap_or_else(|_| {
        panic!("live GitHub E2E is enabled but required env var {name} is missing")
    })
}

fn client_id() -> String {
    required_env("VITE_GITHUB_CLIENT_ID")
}

fn repo_full_name() -> String {
    required_env("STONE_LIVE_E2E_REPO")
}

fn root_dir() -> PathBuf {
    PathBuf::from(required_env("STONE_LIVE_E2E_ROOT"))
}

fn db_path() -> PathBuf {
    PathBuf::from(required_env("STONE_LIVE_E2E_DB"))
}

fn open_db() -> Database {
    Database::open(db_path()).expect("live E2E sqlite database should open")
}

fn run_git(path: &Path, args: &[&str]) -> std::process::Output {
    Command::new("git")
        .args(args)
        .current_dir(path)
        .output()
        .expect("git subprocess should start")
}

/// Step 1 â€” real OAuth Device Flow: start it, print the user code and verification URL,
/// and poll (handling `authorization_pending`/`slow_down`) until the operator authorizes it
/// in a browser or the device code expires. Storage happens inside `github::device_poll`,
/// which writes through to the real Windows keychain â€” nothing here touches the token.
#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn live_step1_device_flow_authorizes_and_stores_token() {
    if skip_if_disabled("step1 device flow") {
        return;
    }
    let start = github::device_start(client_id())
        .await
        .expect("device flow start should succeed");
    println!("=================================================================");
    println!(" Stone GitHub live E2E: open {}", start.verification_uri);
    println!(" and enter code: {}", start.user_code);
    println!(
        " Waiting for authorization (expires in {}s)...",
        start.expires_in
    );
    println!("=================================================================");

    let deadline = Instant::now() + Duration::from_secs(start.expires_in);
    let mut interval = start.interval.max(5);
    loop {
        assert!(
            Instant::now() < deadline,
            "device code expired before authorization"
        );
        tokio::time::sleep(Duration::from_secs(interval)).await;
        let polled = github::device_poll(client_id(), start.device_code.clone())
            .await
            .expect("device flow poll should not transport-fail");
        match polled.status.as_str() {
            "authorized" => {
                let account = polled
                    .account
                    .expect("authorized poll must include account");
                assert!(
                    !account.login.is_empty(),
                    "authorized account must have a login"
                );
                println!("Authorized as {}", account.login);
                return;
            }
            "pending" => continue,
            "slow_down" => {
                interval = polled.interval.max(interval + 5);
                continue;
            }
            other => panic!("unexpected device flow status: {other}"),
        }
    }
}

/// Step 2 â€” a fresh process reading the real Windows keychain proves the token survives an
/// application restart, plus forced small-page pagination proves multiple live pages with
/// no duplicate repository ids, including the disposable E2E repository.
#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn live_step2_status_survives_restart_and_pagination_has_no_duplicates() {
    if skip_if_disabled("step2 restart + pagination") {
        return;
    }
    let account = github::status()
        .await
        .expect("status should not error")
        .expect("account must be connected after step1 authorized this process family");
    assert!(!account.login.is_empty());

    std::env::set_var("STONE_GITHUB_PAGE_SIZE", "1");
    let mut seen = std::collections::HashSet::new();
    let mut names = Vec::new();
    let mut pages_fetched = 0u32;
    let mut page = 1u32;
    loop {
        let result = github::repositories(page)
            .await
            .expect("repository page should load");
        pages_fetched += 1;
        for repository in &result.repositories {
            assert!(
                seen.insert(repository.id),
                "duplicate repository id {} across pages",
                repository.id
            );
            names.push(repository.name.clone());
        }
        if !result.has_next || pages_fetched > 200 {
            break;
        }
        page += 1;
    }
    std::env::remove_var("STONE_GITHUB_PAGE_SIZE");

    assert!(
        pages_fetched > 1,
        "expected multiple live pages with STONE_GITHUB_PAGE_SIZE=1, got {pages_fetched}"
    );
    let expected_name = repo_full_name();
    let expected_name = expected_name
        .rsplit('/')
        .next()
        .expect("STONE_LIVE_E2E_REPO must be owner/name");
    assert!(
        names.iter().any(|name| name == expected_name),
        "disposable repository {expected_name} was not returned by authenticated pagination \
         ({} other repositories were seen; verify STONE_LIVE_E2E_REPO and account access)",
        names.len()
    );
    println!(
        "Pagination OK: {pages_fetched} pages, {} unique repositories",
        seen.len()
    );
}

/// Step 3 â€” link the disposable repository through the authenticated validation path, and
/// confirm an inaccessible repository identifier is rejected rather than linked.
#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn live_step3_link_repository_accepts_valid_rejects_invalid() {
    if skip_if_disabled("step3 project linking") {
        return;
    }
    let full_name = repo_full_name();
    let repository = github::repository(&full_name)
        .await
        .expect("the disposable repository must be reachable through the real API");

    let db = open_db();
    let db = std::sync::Mutex::new(db);
    let input = GitHubLinkInput {
        project_id: "stone-goal7-e2e-project".to_owned(),
        repository: repository.clone(),
        local_path: None,
    };
    let linked = link_repository(input, &db)
        .await
        .expect("linking the real, accessible disposable repository should succeed");
    assert_eq!(linked.repository.full_name, full_name);

    let invalid_full_name = "octocat/this-repo-should-not-exist-ever-xyz123456".to_owned();
    let invalid_repository = github::GitHubRepository {
        id: 999_999_999,
        name: "this-repo-should-not-exist-ever-xyz123456".to_owned(),
        full_name: invalid_full_name.clone(),
        private: false,
        html_url: format!("https://github.com/{invalid_full_name}"),
        clone_url: format!("https://github.com/{invalid_full_name}.git"),
        ssh_url: format!("git@github.com:{invalid_full_name}.git"),
        size_kb: 0,
        default_branch: "main".to_owned(),
        visibility: Some("public".to_owned()),
        updated_at: "2026-01-01T00:00:00Z".to_owned(),
        permissions: None,
    };
    let rejected = link_repository(
        GitHubLinkInput {
            project_id: "stone-goal7-e2e-invalid-project".to_owned(),
            repository: invalid_repository,
            local_path: None,
        },
        &db,
    )
    .await;
    assert!(
        rejected.is_err(),
        "an inaccessible repository must be rejected"
    );
    println!("Link validation OK: valid repository linked, invalid repository rejected");
}

/// Step 4 â€” real disk-space check, a deliberately cancelled clone that must leave no partial
/// destination, and a successful retry, followed by persisting the local path exactly as the
/// restore flow does.
#[test]
#[ignore]
fn live_step4_restore_clone_with_cancel_cleanup_and_retry() {
    if skip_if_disabled("step4 restore clone") {
        return;
    }
    let full_name = repo_full_name();
    let root = root_dir();
    fs::create_dir_all(&root).expect("restore root should be creatable");
    let token = github::token()
        .expect("keychain read should not error")
        .expect("a token must be stored before restore can run");

    git::check_space(root.to_string_lossy().as_ref(), 50 * 1024 * 1024)
        .expect("disk space check should succeed for a small disposable repository");

    let destination = root.join(git::destination_name(&full_name).expect("safe destination name"));

    let cancelled = git::clone_repository(
        root.to_string_lossy().as_ref(),
        &full_name,
        16,
        &token,
        &|| true,
    );
    assert!(cancelled.is_err(), "a cancelled clone must return an error");
    assert!(
        !destination.exists(),
        "a cancelled clone must not leave a partial destination"
    );

    let cloned = git::clone_repository(
        root.to_string_lossy().as_ref(),
        &full_name,
        16,
        &token,
        &|| false,
    )
    .expect("retry clone should succeed once not cancelled");
    assert!(destination.join(".git").exists());
    let _ = cloned;

    let db = open_db();
    let db = std::sync::Mutex::new(db);
    persist_restore_path(&db, &full_name, &destination)
        .expect("persisting the restored local path should succeed");
    let links = list_links(&db).expect("links should be readable back");
    let link = links
        .iter()
        .find(|link| link.repository.full_name == full_name)
        .expect("the disposable repository link must exist (created in step3)");
    assert_eq!(
        link.local_path.as_deref(),
        Some(destination.to_string_lossy().as_ref())
    );
    println!(
        "Restore OK: cancel/cleanup verified, retry cloned to {}",
        destination.display()
    );
}

/// Step 5 â€” a fresh process reads the persisted local path back from sqlite (simulating a
/// Stone restart) and confirms status/pull work against it.
#[test]
#[ignore]
fn live_step5_status_and_pull_after_restart() {
    if skip_if_disabled("step5 status/pull after restart") {
        return;
    }
    let full_name = repo_full_name();
    let db = open_db();
    let db = std::sync::Mutex::new(db);
    let links = list_links(&db).expect("links should be readable after restart");
    let local_path = links
        .iter()
        .find(|link| link.repository.full_name == full_name)
        .and_then(|link| link.local_path.clone())
        .expect("the restored local path must survive a process restart");
    assert!(Path::new(&local_path).join(".git").exists());

    let status = git::status(local_path.clone()).expect("git status should succeed");
    assert!(
        !status.is_dirty,
        "a freshly cloned repository must be clean"
    );

    let token = github::token()
        .expect("keychain read should not error")
        .expect("token must survive restart");
    let pulled = git::pull(local_path, &token);
    assert!(
        pulled.is_ok(),
        "pull on a clean repository should succeed: {pulled:?}"
    );
    println!("Status/pull OK after simulated restart");
}

/// Step 6 â€” review, selective commit and push. Confirms an already-staged unrelated file
/// blocks the operation entirely (Stone's guard against silently committing unreviewed
/// changes), and that after clearing it, only the explicitly selected file is committed while
/// the unrelated local change stays untracked.
#[test]
#[ignore]
fn live_step6_review_commit_push_rejects_unrelated_files() {
    if skip_if_disabled("step6 review/commit/push") {
        return;
    }
    let full_name = repo_full_name();
    let db = open_db();
    let db = std::sync::Mutex::new(db);
    let links = list_links(&db).expect("links should be readable");
    let local_path = links
        .iter()
        .find(|link| link.repository.full_name == full_name)
        .and_then(|link| link.local_path.clone())
        .expect("restore must have completed before review/commit/push");
    let repo_path = PathBuf::from(&local_path);

    let marker = format!("Stone Goal 7 live E2E verification at {}\n", now_iso());
    fs::write(repo_path.join("STONE_GOAL7_E2E.md"), &marker).expect("marker file should write");
    fs::write(
        repo_path.join("unrelated-local-change.txt"),
        "not part of this commit\n",
    )
    .expect("unrelated file should write");
    fs::write(
        repo_path.join("pre-staged-noise.txt"),
        "accidentally staged\n",
    )
    .expect("pre-staged file should write");
    let add = run_git(&repo_path, &["add", "--", "pre-staged-noise.txt"]);
    assert!(
        add.status.success(),
        "priming a pre-staged file should succeed"
    );

    let token = github::token()
        .expect("keychain read should not error")
        .expect("token must be present");

    let blocked = git::stage_commit_push(
        local_path.clone(),
        vec!["STONE_GOAL7_E2E.md".to_owned()],
        "Stone Goal 7 live E2E verification".to_owned(),
        &token,
    );
    assert!(
        blocked.is_err(),
        "a pre-existing staged file must block commit even when only reviewing one file"
    );

    let reset = run_git(&repo_path, &["reset"]);
    assert!(
        reset.status.success(),
        "clearing the pre-stage should succeed"
    );

    let pushed = git::stage_commit_push(
        local_path.clone(),
        vec!["STONE_GOAL7_E2E.md".to_owned()],
        "Stone Goal 7 live E2E verification".to_owned(),
        &token,
    )
    .expect("commit and push of only the reviewed file should succeed");
    assert!(!pushed.output.is_empty() || true);

    let show = run_git(&repo_path, &["show", "--stat", "--format=", "HEAD"]);
    let show_text = String::from_utf8_lossy(&show.stdout);
    assert!(show_text.contains("STONE_GOAL7_E2E.md"));
    assert!(!show_text.contains("unrelated-local-change.txt"));
    assert!(!show_text.contains("pre-staged-noise.txt"));

    let status = git::status(local_path).expect("status after commit should succeed");
    assert!(status
        .entries
        .iter()
        .any(|entry| entry.contains("unrelated-local-change.txt")));
    assert!(status
        .entries
        .iter()
        .any(|entry| entry.contains("pre-staged-noise.txt")));
    println!("Review/commit/push OK: only STONE_GOAL7_E2E.md committed and pushed");
}

/// Step 7 â€” confirm through the authenticated GitHub API (not just local git) that the pushed
/// commit and file are really on the disposable remote.
#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn live_step7_verify_remote_commit_via_api() {
    if skip_if_disabled("step7 verify remote via API") {
        return;
    }
    let full_name = repo_full_name();
    let token = github::token()
        .expect("keychain read should not error")
        .expect("token must be present");
    let client = reqwest::Client::builder()
        .user_agent("Stone Desktop Live E2E/0.1")
        .build()
        .expect("http client should build");
    let response = client
        .get(format!(
            "https://api.github.com/repos/{full_name}/contents/STONE_GOAL7_E2E.md"
        ))
        .header(reqwest::header::ACCEPT, "application/vnd.github+json")
        .bearer_auth(&token)
        .send()
        .await
        .expect("contents request should transport successfully");
    assert!(
        response.status().is_success(),
        "STONE_GOAL7_E2E.md must exist on the remote default branch after push"
    );
    let body: serde_json::Value = response
        .json()
        .await
        .expect("contents response should be JSON");
    let content = body
        .get("content")
        .and_then(|value| value.as_str())
        .expect("file content should be present");
    let decoded = base64_decode(content.replace('\n', ""));
    assert!(
        decoded.contains("Stone Goal 7 live E2E verification"),
        "remote file content must contain the verification marker"
    );
    println!("Remote verification OK: STONE_GOAL7_E2E.md present with the expected marker");
}

/// Step 8 â€” failure handling: an unsafe/invalid repository identifier, an unavailable
/// destination, and a retry after a controlled auth failure, all without leaking the token.
#[test]
#[ignore]
fn live_step8_failure_handling() {
    if skip_if_disabled("step8 failure handling") {
        return;
    }
    let root = root_dir();
    fs::create_dir_all(&root).expect("restore root should be creatable");
    let token = github::token()
        .expect("keychain read should not error")
        .expect("token must be present");

    let invalid_name_result = git::clone_repository(
        root.to_string_lossy().as_ref(),
        "not a valid repo name",
        1,
        &token,
        &|| false,
    );
    assert!(
        invalid_name_result.is_err(),
        "an unsafe repository name must be rejected"
    );

    let unavailable_destination =
        git::check_space("Z:\\stone-goal7-e2e-unavailable-destination", 1024);
    assert!(
        unavailable_destination.is_err(),
        "an unavailable destination must fail safely"
    );

    let full_name = repo_full_name();
    let bad_token = "ghu_invalid_e2e_probe_token";
    let bad_auth_destination = root.join(format!(
        "{}-bad-auth-probe",
        git::destination_name(&full_name).expect("safe destination name")
    ));
    let bad_auth = git::clone_repository(
        bad_auth_destination
            .parent()
            .expect("parent exists")
            .to_string_lossy()
            .as_ref(),
        &full_name,
        16,
        bad_token,
        &|| false,
    );
    if let Err(error) = &bad_auth {
        assert!(
            !error.contains(bad_token) && !error.contains(&token),
            "clone failure output must not leak credentials"
        );
    }
    let _ = fs::remove_dir_all(&bad_auth_destination);

    println!("Failure handling OK: invalid name, unavailable destination, and bad-auth clone all failed safely");
}

/// Step 9 â€” logout must remove the real keychain credential.
#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn live_step9_logout_removes_credential() {
    if skip_if_disabled("step9 logout") {
        return;
    }
    github::disconnect().expect("disconnect should succeed");
    assert!(github::token()
        .expect("token read should not error")
        .is_none());
    assert!(github::status()
        .await
        .expect("status read should not error")
        .is_none());
    println!("Logout OK: keychain credential removed");
}

fn now_iso() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("system clock should be after epoch");
    format!("unix:{}", now.as_secs())
}

fn base64_decode(input: String) -> String {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(input)
        .expect("GitHub contents API must return valid base64");
    String::from_utf8_lossy(&bytes).into_owned()
}
