use serde::Serialize;

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

#[derive(Debug, Serialize)]
pub struct GitBranchInfo {
    pub current: String,
    pub branches: Vec<String>,
}

/// Runs `git diff --no-color --unified=3` in the given directory.
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
        let exit_code = output.status.code().unwrap_or(-1);
        if exit_code == 128 || stderr.to_lowercase().contains("not a git repository") {
            return Ok(GitDiffResult {
                files: vec![],
                summary: DiffSummary { files_changed: 0, insertions: 0, deletions: 0 },
                working_dir: canonical.to_string_lossy().to_string(),
            });
        }
        return Err(format!("git diff failed: {}", stderr.trim()));
    }

    let raw = String::from_utf8_lossy(&output.stdout).to_string();
    let result = parse_git_diff(&raw, &canonical.to_string_lossy());
    Ok(result)
}

/// Returns the current branch and all local branches for the given directory.
#[tauri::command]
pub fn get_git_branches(cwd: String) -> Result<GitBranchInfo, String> {
    use std::process::Command;

    let canonical = std::path::PathBuf::from(&cwd)
        .canonicalize()
        .map_err(|e| format!("directory not found: {}", e))?;

    if !canonical.is_dir() {
        return Err("directory not found".into());
    }

    let output = Command::new("git")
        .args(["branch", "--list"])
        .current_dir(&canonical)
        .output()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                "git not available".into()
            } else {
                format!("git branch failed: {}", e)
            }
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git branch failed: {}", stderr.trim()));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut current = String::new();
    let mut branches: Vec<String> = Vec::new();

    for line in stdout.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Some(name) = trimmed.strip_prefix("* ") {
            current = name.to_string();
            branches.push(name.to_string());
        } else {
            branches.push(trimmed.to_string());
        }
    }

    Ok(GitBranchInfo { current, branches })
}

/// Runs `git checkout <branch>` in the given directory.
#[tauri::command]
pub fn checkout_git_branch(cwd: String, branch: String) -> Result<(), String> {
    use std::process::Command;

    let canonical = std::path::PathBuf::from(&cwd)
        .canonicalize()
        .map_err(|e| format!("directory not found: {}", e))?;

    if !canonical.is_dir() {
        return Err("directory not found".into());
    }

    let output = Command::new("git")
        .args(["checkout", &branch])
        .current_dir(&canonical)
        .output()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                "git not available".into()
            } else {
                format!("git checkout failed: {}", e)
            }
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git checkout failed: {}", stderr.trim()));
    }

    Ok(())
}

pub fn parse_git_diff(raw: &str, working_dir: &str) -> GitDiffResult {
    let mut files: Vec<DiffFile> = Vec::new();
    let mut summary = DiffSummary { files_changed: 0, insertions: 0, deletions: 0 };

    let mut current_file: Option<DiffFile> = None;
    let mut current_hunk: Option<DiffHunk> = None;
    let mut running_old: u32 = 0;
    let mut running_new: u32 = 0;

    for line in raw.lines() {
        if line.starts_with("diff --git ") {
            if let Some(mut f) = current_file.take() {
                if let Some(h) = current_hunk.take() {
                    f.hunks.push(h);
                }
                summary.files_changed += 1;
                files.push(f);
            }
            let parts: Vec<&str> = line[11..].split(' ').collect();
            let path = if let Some(p) = parts.get(1) {
                p.strip_prefix("b/").unwrap_or(p).to_string()
            } else {
                "unknown".to_string()
            };
            current_file = Some(DiffFile { path, old_path: None, status: FileStatus::Modified, hunks: vec![] });
        } else if line.starts_with("+++ ") || line.starts_with("--- ") {
            // captured from diff --git header
        } else if line.starts_with("@@ ") && current_file.is_some() {
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
                    hunk.lines.push(DiffLine { kind: LineKind::Addition, old_lineno: None, new_lineno: Some(running_new), content: line[1..].to_string() });
                    running_new += 1;
                    summary.insertions += 1;
                } else if line.starts_with('-') {
                    hunk.lines.push(DiffLine { kind: LineKind::Deletion, old_lineno: Some(running_old), new_lineno: None, content: line[1..].to_string() });
                    running_old += 1;
                    summary.deletions += 1;
                } else if line.starts_with(' ') || line.is_empty() {
                    let content = if line.starts_with(' ') { line[1..].to_string() } else { String::new() };
                    hunk.lines.push(DiffLine { kind: LineKind::Context, old_lineno: Some(running_old), new_lineno: Some(running_new), content });
                    running_old += 1;
                    running_new += 1;
                }
            }
        }
    }

    if let Some(mut f) = current_file {
        if let Some(h) = current_hunk {
            f.hunks.push(h);
        }
        summary.files_changed += 1;
        files.push(f);
    }

    GitDiffResult { files, summary, working_dir: working_dir.to_string() }
}

pub fn parse_hunk_header(line: &str) -> Option<DiffHunk> {
    let header = line.to_string();
    let rest = line.strip_prefix("@@ ")?.trim_start();
    let body = rest.split(" @@").next()?;
    let parts: Vec<&str> = body.split_whitespace().collect();
    if parts.len() < 2 {
        return None;
    }
    let old = parse_range(parts[0]);
    let new = parse_range(parts[1]);
    Some(DiffHunk { header, old_start: old.0, old_count: old.1, new_start: new.0, new_count: new.1, lines: vec![] })
}

fn parse_range(s: &str) -> (u32, u32) {
    let s = s.strip_prefix('-').unwrap_or(s);
    let s = s.strip_prefix('+').unwrap_or(s);
    let mut parts = s.split(',');
    let start: u32 = parts.next().unwrap_or("1").parse().unwrap_or(1);
    let count: u32 = parts.next().unwrap_or("1").parse().unwrap_or(1);
    (start, count)
}
