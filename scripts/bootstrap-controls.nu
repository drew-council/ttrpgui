#!/usr/bin/env nu
# GPUI Kit's component layer, adapted to the same GPUI graph as the editor.
def --wrapped checked [...command: string] {
  let result = (run-external ...$command | complete)
  if $result.exit_code != 0 {
    error make {msg: $"($command | str join ' ') failed:\n($result.stderr)\n($result.stdout)"}
  }
}
def main [--destination: path] {
  let root = ($env.FILE_PWD | path dirname)
  let pin = (open ($root | path join upstream gpui-component.lock.toml))
  let target = ($destination | default ($root | path join upstream gpui-component))
  let patch = ($root | path join $pin.patch)
  let fingerprint = ([$pin.version $pin.sha256 (open --raw $patch)] | str join "\n" | hash sha256)
  let marker = ($target | path join .ttrpgui-source)
  if ($target | path exists) {
    if not ($marker | path exists) {
      error make {msg: $"($target) already exists without a bootstrap marker; preserve it before bootstrapping."}
    }
    if (open --raw $marker | str trim) != $fingerprint {
      error make {msg: "The controls pin or patch changed; preserve the checkout and bootstrap a fresh directory."}
    }
    checked patch --batch --dry-run --reverse -p1 -d ($target | into string) -i $patch
    print $"Pinned GPUI Kit components verified at ($target)"
    return
  }
  mkdir ($target | path dirname)
  let stage = (mktemp -d | str trim)
  let archive = ($stage | path join components.tar.gz)
  try {
    checked curl --fail --location --silent --show-error $pin.archive --output $archive
    if (open --raw $archive | hash sha256) != $pin.sha256 {
      error make {msg: "GPUI Kit component archive checksum mismatch"}
    }
    checked tar -xzf $archive -C $stage
    let source = ($stage | path join $"gpui-component-($pin.version)")
    checked patch --batch --forward -p1 -d $source -i $patch
    $fingerprint | save --raw ($source | path join .ttrpgui-source)
    mv $source $target
  } catch {|err|
    rm -rf $stage
    error make {msg: $err.msg}
  }
  rm -rf $stage
  print $"Prepared GPUI Kit components ($pin.version) at ($target)"
}
