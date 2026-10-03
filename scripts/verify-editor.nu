#!/usr/bin/env nu
# Run from `nix develop`. Neovim is only used by the comparison tests.
def --wrapped checked [...command: string] {
  run-external ...$command
  if $env.LAST_EXIT_CODE != 0 {
    error make {msg: $"($command | str join ' ') failed"}
  }
}

def main [--neovim] {
  cd ($env.FILE_PWD | path dirname)
  checked nu scripts/bootstrap.nu
  checked cargo check --locked
  checked cargo test --locked -p campaign_domain -p campaign_storage -p campaign_documents
  checked cargo test --locked --test launcher
  let data = (mktemp -d | str trim)
  try {
    with-env {TTRPGUI_DATA_DIR: $data} {
      checked cargo run --locked -- --smoke-test
      checked cargo run --locked -- --campaign-smoke-test
    }
  } catch {|error| rm -rf $data; error make {msg: $error.msg} }
  rm -rf $data
  checked cargo test --manifest-path upstream/zed/Cargo.toml --locked -p markdown_live_preview --lib -- --test-threads=2
  checked cargo test --manifest-path upstream/zed/Cargo.toml --locked -p vim --lib -- --test-threads=2
  if $neovim {
    checked cargo test --manifest-path upstream/zed/Cargo.toml --locked -p vim --features neovim --lib campaign_markdown -- --test-threads=2
  }
}
