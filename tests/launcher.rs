use std::{
    process::{Command, Stdio},
    time::{Duration, Instant},
};

fn invoke(args: &[&str]) -> std::process::Output {
    let mut command = Command::new(env!("CARGO_BIN_EXE_ttrpgui"));
    // Deliberately provide no display, shell initialization, or personal env.
    command.env_clear().env("TTRPGUI_HELPER_TEST", "sentinel");
    if let Some(path) = std::env::var_os("LD_LIBRARY_PATH") {
        command.env("LD_LIBRARY_PATH", path);
    }
    let mut child = command
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        if child.try_wait().unwrap().is_some() {
            return child.wait_with_output().unwrap();
        }
        if Instant::now() >= deadline {
            child.kill().unwrap();
            let _ = child.wait();
            panic!("non-GUI invocation failed to exit within five seconds");
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}

#[test]
fn upstream_printenv_helper_exits_without_gui() {
    let output = invoke(&["--printenv"]);
    assert!(output.status.success());
    let text = String::from_utf8(output.stdout).unwrap();
    assert!(text.starts_with('{') && text.trim_end().ends_with('}'));
    assert!(text.contains("\"TTRPGUI_HELPER_TEST\": \"sentinel\""));
    assert!(output.stderr.is_empty());
}

#[test]
fn help_and_unknown_arguments_do_not_start_gui() {
    let output = invoke(&["--help"]);
    assert!(output.status.success());
    assert!(String::from_utf8(output.stdout).unwrap().contains("Usage:"));
    let output = invoke(&["--unsupported-helper"]);
    assert!(!output.status.success());
    assert!(
        String::from_utf8(output.stderr)
            .unwrap()
            .contains("unsupported arguments")
    );
}

#[test]
fn instance_lock_prevents_another_gui() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(".editor-proof");
    std::fs::create_dir_all(&root).unwrap();
    let lock = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(root.join("instance.lock"))
        .unwrap();
    lock.try_lock().unwrap();
    let output = invoke(&[]);
    assert!(!output.status.success());
    assert!(
        String::from_utf8(output.stderr)
            .unwrap()
            .contains("already running")
    );
    // Helpers must also succeed while another GUI holds the lock.
    assert!(invoke(&["--printenv"]).status.success());
}
