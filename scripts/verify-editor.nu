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
  checked cargo test --locked --test launcher
  checked cargo run --locked -- --smoke-test
  checked cargo test --manifest-path upstream/zed/Cargo.toml --locked -p markdown_live_preview --lib
  checked cargo test --manifest-path upstream/zed/Cargo.toml --locked -p vim --lib
  if $neovim {
    checked cargo test --manifest-path upstream/zed/Cargo.toml --locked -p vim --features neovim --lib campaign_markdown
  }
}
