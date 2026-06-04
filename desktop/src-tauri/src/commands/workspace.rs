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

#[derive(Debug, Serialize)]
pub struct WorkspaceFileResult {
    pub content: Option<String>,
    pub truncated: bool,
    pub binary: bool,
    pub size: u64,
}

const WORKSPACE_FILE_MAX_BYTES: u64 = 100 * 1024;

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

#[tauri::command]
pub fn read_workspace_file(root: String, path: String) -> Result<WorkspaceFileResult, String> {
    let canonical_root = canonicalize_existing_dir(&root, "workspace root")?;
    let canonical_path = PathBuf::from(&path)
        .canonicalize()
        .map_err(|e| format!("file not found: {}", e))?;

    if !canonical_path.starts_with(&canonical_root) {
        return Err("path escapes workspace root".to_string());
    }

    let meta = fs::metadata(&canonical_path).map_err(|e| format!("cannot stat file: {}", e))?;
    let size = meta.len();

    let truncated = size > WORKSPACE_FILE_MAX_BYTES;
    let read_len = size.min(WORKSPACE_FILE_MAX_BYTES) as usize;

    let mut buf = vec![0u8; read_len];
    {
        use std::io::Read;
        let mut f = fs::File::open(&canonical_path).map_err(|e| format!("cannot open file: {}", e))?;
        f.read_exact(&mut buf).map_err(|e| format!("read error: {}", e))?;
    }

    match String::from_utf8(buf) {
        Ok(content) => Ok(WorkspaceFileResult { content: Some(content), truncated, binary: false, size }),
        Err(_) => Ok(WorkspaceFileResult { content: None, truncated: false, binary: true, size }),
    }
}

pub(super) fn canonicalize_existing_dir(path: &str, label: &str) -> Result<PathBuf, String> {
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
