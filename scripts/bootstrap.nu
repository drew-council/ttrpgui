#!/usr/bin/env nu
# Materialize one audited source graph; never overwrite a developer's checkout.
def --wrapped checked [...command: string] {
  let result = (run-external ...$command | complete)
  if $result.exit_code != 0 {
    error make {msg: $"($command | str join ' ') failed:\n($result.stderr)\n($result.stdout)"}
  }
}

def main [--destination: path] {
  let root = ($env.FILE_PWD | path dirname)
  let pin = (open ($root | path join upstream zed.lock.toml))
  let target = ($destination | default ($root | path join upstream zed))
  let patches = ($pin.patches | each {|p| $root | path join $p })
  let fingerprint = ([$pin.revision $pin.sha256 ...($patches | each {|p| open --raw $p })] | str join "\n" | hash sha256)
  let marker = ($target | path join .ttrpgui-source)
  if ($target | path exists) {
    if not ($marker | path exists) {
      error make {msg: $"($target) already exists without a bootstrap marker. Preserve or move it before bootstrapping."}
    }
    if (open --raw $marker | str trim) != $fingerprint {
      error make {msg: "The source pin or patches changed. Preserve the existing checkout, then bootstrap a fresh directory."}
    }
    for patch in $patches {
      checked patch --batch --dry-run --reverse -p1 -d ($target | into string) -i $patch
    }
    print $"Pinned Zed source and patches verified at ($target)"
    return
  }
  mkdir ($target | path dirname)
  let stage = (mktemp -d | str trim)
  let archive = ($stage | path join zed.tar.gz)
  try {
    checked curl --fail --location --silent --show-error $pin.archive --output $archive
    let actual = (open --raw $archive | hash sha256)
    if $actual != $pin.sha256 {
      error make {msg: $"Zed archive checksum mismatch: ($actual)"}
    }
    checked tar -xzf $archive -C $stage
    let source = ($stage | path join $"zed-($pin.revision)")
    for patch in $patches {
      checked patch --batch --forward -p1 -d $source -i $patch
    }
    $fingerprint | save --raw ($source | path join .ttrpgui-source)
    mv $source $target
  } catch {|err|
    rm -rf $stage
    error make {msg: $err.msg}
  }
  rm -rf $stage
  print $"Prepared Zed ($pin.revision) at ($target)"
}
