#!/usr/bin/env nu
# Build and package locally without opening a window. Run in `nix develop`.
def --wrapped checked [...command: string] {
  let result = (run-external ...$command | complete)
  if $result.exit_code != 0 { error make {msg: $"($command | str join ' ') failed:\n($result.stderr)\n($result.stdout)"} }
  $result.stdout | str trim
}
def main [--release] {
  let root = ($env.FILE_PWD | path dirname)
  cd $root
  checked nu scripts/bootstrap.nu | print
  if $release { checked cargo build --locked --release | print } else { checked cargo build --locked | print }
  let profile = (if $release { "release" } else { "debug" })
  let binary = ($root | path join target $profile ttrpgui)
  mkdir dist
  let source = ($root | path join dist source.tar.gz)
  checked tar --exclude=./target --exclude=./upstream/zed --exclude=./.git --exclude=./.editor-proof --exclude=./dist --exclude=./.direnv -czf $source . | ignore
  let runtime = (checked nix build .#runtime --no-link --print-out-paths)
  let system = (checked nix eval --impure --raw --expr builtins.currentSystem)
  let nixpkgs = (checked nix eval --raw $".#legacyPackages.($system).path")
  checked nix-build nix/package.nix --argstr binary $binary --argstr runtime $runtime --argstr nixpkgsPath $nixpkgs --argstr sourceArchive $source --out-link dist/ttrpgui | print
  print "Package ready at dist/ttrpgui/bin/ttrpgui. No GUI was launched."
}
