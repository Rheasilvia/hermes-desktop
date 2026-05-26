use serde::Serialize;
use std::fs;
use std::path::PathBuf;

const WORKSPACE_CHILD_LIMIT: usize = 1000;
const SKIPPED_WORKSPACE_DIRS: &[&str] = &[
    ".git",
    ".hg",
    ".svn",
    ".cache",
    ".next",
    ".nuxt",
    ".pytest_cache",
    ".ruff_cache",
    ".mypy_cache",
    "__pycache__",
    "node_modules",
    "dist",
    "build",
    "target",
    "venv",
    ".venv",
];

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Platform {
    Windows,
    MacOS,
    Linux,
}

/// Returns the desktop app version from Cargo.toml
#[tauri::command]
pub fn get_app_version(app: tauri::AppHandle) -> String {
    app.config()
        .version
        .clone()
        .unwrap_or_else(|| "0.1.0".to_string())
}

/// Returns the HERMES_HOME directory path
/// Uses ~/.hermes as default, consistent with the Python backend,
/// with option to override via HERMES_HOME env var.
#[tauri::command]
pub fn get_hermes_home(_app: tauri::AppHandle) -> Result<String, String> {
    // Check for HERMES_HOME env var first (for connecting to existing hermes installations)
    if let Ok(custom_home) = std::env::var("HERMES_HOME") {
        return Ok(custom_home);
    }
    // Default: use ~/.hermes (consistent with Python backend)
    let home_dir = std::env::var("HOME")
        .map(PathBuf::from)
        .or_else(|_| std::env::var("USERPROFILE").map(PathBuf::from))
        .map_err(|_| "Failed to get home directory".to_string())?;
    let hermes_home = home_dir.join(".hermes");
    Ok(hermes_home.to_string_lossy().to_string())
}

/// Reads a file relative to HERMES_HOME
#[tauri::command]
pub fn read_file(path: String, app: tauri::AppHandle) -> Result<String, String> {
    let home = get_hermes_home(app)?;
    let full_path = PathBuf::from(&home).join(&path);

    // Security: ensure path doesn't escape HERMES_HOME
    let canonical_home = std::fs::canonicalize(&home)
        .or_else(|_| std::fs::create_dir_all(&home).and_then(|_| std::fs::canonicalize(&home)))
        .map_err(|e| format!("Invalid home path: {}", e))?;
    let canonical_path = full_path
        .canonicalize()
        .map_err(|e| format!("Invalid file path: {}", e))?;

    if !canonical_path.starts_with(&canonical_home) {
        return Err("Path escapes HERMES_HOME".to_string());
    }

    fs::read_to_string(canonical_path).map_err(|e| format!("Failed to read file: {}", e))
}

/// Writes a file relative to HERMES_HOME
#[tauri::command]
pub fn write_file(path: String, content: String, app: tauri::AppHandle) -> Result<(), String> {
    let home = get_hermes_home(app.clone())?;
    let full_path = PathBuf::from(&home).join(&path);

    // Create parent directories if needed
    if let Some(parent) = full_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {}", e))?;
    }

    fs::write(full_path, content).map_err(|e| format!("Failed to write file: {}", e))
}

/// Lists directory contents relative to HERMES_HOME
#[tauri::command]
pub fn list_dir(path: String, app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let home = get_hermes_home(app)?;
    let full_path = PathBuf::from(&home).join(&path);

    let entries =
        fs::read_dir(full_path).map_err(|e| format!("Failed to read directory: {}", e))?;

    let mut result: Vec<String> = entries
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.file_name().to_string_lossy().to_string())
        .collect();
    result.sort();
    Ok(result)
}

/// Opens a URL in the default browser
#[tauri::command]
pub async fn open_external(url: String) -> Result<(), String> {
    open::that(&url).map_err(|e| format!("Failed to open URL: {}", e))
}

/// Returns the current platform
#[tauri::command]
pub fn get_platform() -> Platform {
    if cfg!(target_os = "windows") {
        Platform::Windows
    } else if cfg!(target_os = "macos") {
        Platform::MacOS
    } else {
        Platform::Linux
    }
}

/// Spawns a child process (for future gateway connection)
/// Returns the process ID
#[tauri::command]
pub async fn spawn_process(cmd: String, args: Vec<String>) -> Result<u32, String> {
    use std::process::Command;

    let child = Command::new(&cmd)
        .args(&args)
        .spawn()
        .map_err(|e| format!("Failed to spawn process: {}", e))?;

    Ok(child.id())
}

// ── Workspace Tree Types ───────────────────────────────────────────────────

#[derive(Debug, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceNodeKind {
    File,
    Directory,
}

#[derive(Debug, Serialize)]
pub struct WorkspaceTreeNode {
    pub path: String,
    pub name: String,
    pub kind: WorkspaceNodeKind,
    pub ignored: bool,
    pub loaded: bool,
}

#[derive(Debug, Serialize)]
pub struct WorkspaceChildrenResult {
    pub root: String,
    pub path: String,
    pub children: Vec<WorkspaceTreeNode>,
    pub truncated: bool,
    pub total_read: usize,
}

#[tauri::command]
pub fn get_workspace_root(path: String) -> Result<String, String> {
    let canonical = canonicalize_existing_dir(&path, "workspace")?;
    Ok(canonical.to_string_lossy().to_string())
}

#[tauri::command]
pub fn list_workspace_children(
    root: String,
    path: String,
) -> Result<WorkspaceChildrenResult, String> {
    let canonical_root = canonicalize_existing_dir(&root, "workspace root")?;
    let canonical_path = canonicalize_existing_dir(&path, "workspace path")?;

    if !canonical_path.starts_with(&canonical_root) {
        return Err("path escapes workspace root".to_string());
    }

    let mut children = Vec::new();
    let mut total_read = 0usize;
    let mut truncated = false;

    let entries = fs::read_dir(&canonical_path)
        .map_err(|e| format!("permission denied or unreadable directory: {}", e))?;

    for entry in entries {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => continue,
        };
        total_read += 1;

        let name = entry.file_name().to_string_lossy().to_string();
        let file_type = match entry.file_type() {
            Ok(file_type) => file_type,
            Err(_) => continue,
        };

        if file_type.is_symlink() {
            continue;
        }
        if file_type.is_dir() && SKIPPED_WORKSPACE_DIRS.contains(&name.as_str()) {
            continue;
        }
        if !file_type.is_dir() && !file_type.is_file() {
            continue;
        }

        if children.len() >= WORKSPACE_CHILD_LIMIT {
            truncated = true;
            continue;
        }

        let kind = if file_type.is_dir() {
            WorkspaceNodeKind::Directory
        } else {
            WorkspaceNodeKind::File
        };
        let path = entry.path();
        children.push(WorkspaceTreeNode {
            path: path.to_string_lossy().to_string(),
            name,
            kind,
            ignored: false,
            loaded: kind == WorkspaceNodeKind::File,
        });
    }

    children.sort_by(compare_workspace_nodes);

    Ok(WorkspaceChildrenResult {
        root: canonical_root.to_string_lossy().to_string(),
        path: canonical_path.to_string_lossy().to_string(),
        children,
        truncated,
        total_read,
    })
}

fn canonicalize_existing_dir(path: &str, label: &str) -> Result<PathBuf, String> {
    let canonical = PathBuf::from(path)
        .canonicalize()
        .map_err(|e| format!("{} not found: {}", label, e))?;
    if !canonical.is_dir() {
        return Err(format!("{} is not a directory", label));
    }
    Ok(canonical)
}

fn compare_workspace_nodes(a: &WorkspaceTreeNode, b: &WorkspaceTreeNode) -> std::cmp::Ordering {
    use std::cmp::Ordering;

    match (a.kind, b.kind) {
        (WorkspaceNodeKind::Directory, WorkspaceNodeKind::File) => return Ordering::Less,
        (WorkspaceNodeKind::File, WorkspaceNodeKind::Directory) => return Ordering::Greater,
        _ => {}
    }

    match (a.name.starts_with('.'), b.name.starts_with('.')) {
        (true, false) => Ordering::Less,
        (false, true) => Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    }
}

#[cfg(test)]
mod workspace_tree_tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_workspace(name: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("hermes_workspace_tree_{name}_{suffix}"));
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn workspace_children_sort_dirs_files_and_dotfiles() {
        let root = temp_workspace("sort");
        fs::create_dir(root.join("z_dir")).unwrap();
        fs::create_dir(root.join(".a_dir")).unwrap();
        fs::write(root.join("b.txt"), "b").unwrap();
        fs::write(root.join(".a.txt"), "a").unwrap();

        let result = list_workspace_children(
            root.to_string_lossy().to_string(),
            root.to_string_lossy().to_string(),
        )
        .unwrap();
        let names: Vec<_> = result.children.into_iter().map(|n| n.name).collect();
        assert_eq!(names, vec![".a_dir", "z_dir", ".a.txt", "b.txt"]);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn workspace_children_rejects_path_escape() {
        let root = temp_workspace("root");
        let outside = temp_workspace("outside");
        let error = list_workspace_children(
            root.to_string_lossy().to_string(),
            outside.to_string_lossy().to_string(),
        )
        .unwrap_err();
        assert!(error.contains("escapes workspace root"));

        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(outside);
    }

    #[test]
    fn workspace_children_skips_heavy_and_symlink_dirs() {
        let root = temp_workspace("skip");
        fs::create_dir(root.join(".git")).unwrap();
        fs::create_dir(root.join("node_modules")).unwrap();
        fs::create_dir(root.join("src")).unwrap();

        #[cfg(unix)]
        std::os::unix::fs::symlink(root.join("src"), root.join("src_link")).unwrap();

        let result = list_workspace_children(
            root.to_string_lossy().to_string(),
            root.to_string_lossy().to_string(),
        )
        .unwrap();
        let names: Vec<_> = result.children.into_iter().map(|n| n.name).collect();
        assert!(names.contains(&"src".to_string()));
        assert!(!names.contains(&".git".to_string()));
        assert!(!names.contains(&"node_modules".to_string()));
        assert!(!names.contains(&"src_link".to_string()));

        let _ = fs::remove_dir_all(root);
    }
}

// ── Git Diff Types ─────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LineKind {
    Context,
    Addition,
    Deletion,
}

#[derive(Debug, Serialize)]
pub struct DiffLine {
    pub kind: LineKind,
    pub old_lineno: Option<u32>,
    pub new_lineno: Option<u32>,
    pub content: String,
}

#[derive(Debug, Serialize)]
pub struct DiffHunk {
    pub header: String,
    pub old_start: u32,
    pub old_count: u32,
    pub new_start: u32,
    pub new_count: u32,
    pub lines: Vec<DiffLine>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FileStatus {
    Added,
    Modified,
    Deleted,
    Renamed,
}

#[derive(Debug, Serialize)]
pub struct DiffFile {
    pub path: String,
    pub old_path: Option<String>,
    pub status: FileStatus,
    pub hunks: Vec<DiffHunk>,
}

#[derive(Debug, Serialize)]
pub struct DiffSummary {
    pub files_changed: u32,
    pub insertions: u32,
    pub deletions: u32,
}

#[derive(Debug, Serialize)]
pub struct GitDiffResult {
    pub files: Vec<DiffFile>,
    pub summary: DiffSummary,
    pub working_dir: String,
}

// ── Git Diff Command ────────────────────────────────────────────────────────

/// Runs `git diff --no-color --unified=3` in the given directory and returns
/// a structured GitDiffResult.
#[tauri::command]
pub fn run_git_diff(cwd: String) -> Result<GitDiffResult, String> {
    use std::process::Command;

    let cwd_path = std::path::PathBuf::from(&cwd);
    let canonical = cwd_path
        .canonicalize()
        .map_err(|e| format!("directory not found: {}", e))?;

    if !canonical.is_dir() {
        return Err("directory not found".into());
    }

    let output = Command::new("git")
        .args(["diff", "--no-color", "--unified=3"])
        .current_dir(&canonical)
        .output()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                "git not available".into()
            } else {
                format!("git diff failed: {}", e)
            }
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // "not a git repository" → return empty result instead of error
        if stderr.contains("not a git repository") {
            return Ok(GitDiffResult {
                files: vec![],
                summary: DiffSummary {
                    files_changed: 0,
                    insertions: 0,
                    deletions: 0,
                },
                working_dir: canonical.to_string_lossy().to_string(),
            });
        }
        return Err(format!("git diff failed: {}", stderr.trim()));
    }

    let raw = String::from_utf8_lossy(&output.stdout).to_string();
    let result = parse_git_diff(&raw, &canonical.to_string_lossy());
    Ok(result)
}

// ── Diff Parser ─────────────────────────────────────────────────────────────

pub fn parse_git_diff(raw: &str, working_dir: &str) -> GitDiffResult {
    let mut files: Vec<DiffFile> = Vec::new();
    let mut summary = DiffSummary {
        files_changed: 0,
        insertions: 0,
        deletions: 0,
    };

    let mut current_file: Option<DiffFile> = None;
    let mut current_hunk: Option<DiffHunk> = None;
    let mut running_old: u32 = 0;
    let mut running_new: u32 = 0;

    for line in raw.lines() {
        if line.starts_with("diff --git ") {
            // Finalize previous file
            if let Some(mut f) = current_file.take() {
                if let Some(h) = current_hunk.take() {
                    f.hunks.push(h);
                }
                summary.files_changed += 1;
                files.push(f);
            }
            // Parse new file: diff --git a/path b/path
            let parts: Vec<&str> = line[11..].split(' ').collect();
            let path = if let Some(p) = parts.get(1) {
                p.strip_prefix("b/").unwrap_or(p).to_string()
            } else {
                "unknown".to_string()
            };
            current_file = Some(DiffFile {
                path,
                old_path: None,
                status: FileStatus::Modified,
                hunks: vec![],
            });
        } else if line.starts_with("+++ ") || line.starts_with("--- ") {
            // File path lines — already captured from diff --git header
        } else if line.starts_with("@@ ") && current_file.is_some() {
            // Hunk header: @@ -old_start,old_count +new_start,new_count @@
            if let Some(h) = current_hunk.take() {
                current_file.as_mut().unwrap().hunks.push(h);
            }
            if let Some(hunk) = parse_hunk_header(line) {
                running_old = hunk.old_start;
                running_new = hunk.new_start;
                current_hunk = Some(hunk);
            }
        } else if let Some(ref mut _file) = current_file {
            if current_hunk.is_some() {
                let hunk = current_hunk.as_mut().unwrap();
                if line.starts_with('+') {
                    hunk.lines.push(DiffLine {
                        kind: LineKind::Addition,
                        old_lineno: None,
                        new_lineno: Some(running_new),
                        content: line[1..].to_string(),
                    });
                    running_new += 1;
                    summary.insertions += 1;
                } else if line.starts_with('-') {
                    hunk.lines.push(DiffLine {
                        kind: LineKind::Deletion,
                        old_lineno: Some(running_old),
                        new_lineno: None,
                        content: line[1..].to_string(),
                    });
                    running_old += 1;
                    summary.deletions += 1;
                } else if line.starts_with(' ') || line.is_empty() {
                    // Context line (starts with space) or empty context line
                    let content = if line.starts_with(' ') {
                        line[1..].to_string()
                    } else {
                        String::new()
                    };
                    hunk.lines.push(DiffLine {
                        kind: LineKind::Context,
                        old_lineno: Some(running_old),
                        new_lineno: Some(running_new),
                        content,
                    });
                    running_old += 1;
                    running_new += 1;
                }
                // Skip lines starting with `\` (No newline at end of file)
            }
        }
    }

    // Flush last hunk and file
    if let Some(mut f) = current_file {
        if let Some(h) = current_hunk {
            f.hunks.push(h);
        }
        summary.files_changed += 1;
        files.push(f);
    }

    GitDiffResult {
        files,
        summary,
        working_dir: working_dir.to_string(),
    }
}

pub fn parse_hunk_header(line: &str) -> Option<DiffHunk> {
    // Format: @@ -old_start[,old_count] +new_start[,new_count] @@ [optional context]
    let header = line.to_string();
    // Find the inner content between the first @@ and the second @@
    let rest = line.strip_prefix("@@ ")?.trim_start();
    let body = rest.split(" @@").next()?;
    let parts: Vec<&str> = body.split_whitespace().collect();
    if parts.len() < 2 {
        return None;
    }
    let old = parse_range(parts[0]); // -old_start[,old_count]
    let new = parse_range(parts[1]); // +new_start[,new_count]
    Some(DiffHunk {
        header,
        old_start: old.0,
        old_count: old.1,
        new_start: new.0,
        new_count: new.1,
        lines: vec![],
    })
}

fn parse_range(s: &str) -> (u32, u32) {
    let s = s.strip_prefix('-').unwrap_or(s);
    let s = s.strip_prefix('+').unwrap_or(s);
    let mut parts = s.split(',');
    let start: u32 = parts.next().unwrap_or("1").parse().unwrap_or(1);
    let count: u32 = parts.next().unwrap_or("1").parse().unwrap_or(1);
    (start, count)
}
