#[cfg(test)]
mod tests {
    use crate::sidecar;

    #[test]
    fn token_file_path_under_hermes_desktop() {
        std::env::set_var("HERMES_HOME", "/tmp/sidecar-test-home");
        let path = sidecar::token_file();
        let s = path.to_string_lossy();
        assert!(s.ends_with("desktop/sidecar.token"), "got {s}");
    }
}
