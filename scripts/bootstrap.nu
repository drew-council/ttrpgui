#!/usr/bin/env nu
# Materialize one audited source graph; never overwrite a developer's checkout.
def --wrapped checked [...command: string] {
  let result = (run-external ...$command | complete)
  if $result.exit_code != 0 {
    error make {msg: $"($command | str join ' ') failed:\n($result.stderr)\n($result.stdout)"}
  }
}

# Repository-relative files touched by a unified diff.
def patched-files [patch: path] {
  open --raw $patch | lines
  | where {|line| $line starts-with "+++ " or $line starts-with "--- " }
  | each {|line| $line | str substring 4.. | split row "\t" | first | str trim }
  | where {|file| $file != "/dev/null" }
  | each {|file| $file | str replace --regex '^[ab]/' "" }
}

# Download the pinned archive into `stage` and return its extracted source.
def fetch-pinned [pin: record stage: path] {
  let archive = ($stage | path join zed.tar.gz)
  checked curl --fail --location --silent --show-error $pin.archive --output $archive
  let actual = (open --raw $archive | hash sha256)
  if $actual != $pin.sha256 {
    error make {msg: $"Zed archive checksum mismatch: ($actual)"}
  }
  checked tar -xzf $archive -C $stage
  $stage | path join $"zed-($pin.revision)"
}

# Patches overlap, so validate the series as a whole: copy only the touched
# files into an owned tree and reverse every patch, newest first. The caller's
# checkout is only read.
def verify-series [target: path patches: list<path>] {
  let stage = (mktemp -d | str trim)
  try {
    let files = ($patches | each {|p| patched-files $p } | flatten | uniq)
    for file in $files {
      let source = ($target | path join $file)
      if ($source | path exists) {
        let copy = ($stage | path join $file)
        mkdir ($copy | path dirname)
        cp $source $copy
      }
    }
    for patch in ($patches | reverse) {
      checked patch --batch --reverse --fuzz=0 -p1 -d ($stage | into string) -i $patch
    }
  } catch {|err|
    rm -rf $stage
    error make {msg: $"Patch series does not reverse cleanly from ($target):\n($err.msg)"}
  }
  rm -rf $stage
}

# Compare every source file with a fresh, checksum-verified application of the
# series. Build output and VCS metadata are ignored.
def verify-pristine [target: path pin: record patches: list<path>] {
  let stage = (mktemp -d | str trim)
  let result = try {
    let source = (fetch-pinned $pin $stage)
    for patch in $patches {
      checked patch --batch --forward -p1 -d $source -i $patch
    }
    ^diff -rq --exclude=target --exclude=.git --exclude=.ttrpgui-source $source $target | complete
  } catch {|err|
    rm -rf $stage
    error make {msg: $err.msg}
  }
  rm -rf $stage
  if $result.exit_code != 0 {
    error make {msg: $"($target) differs from the pinned source and patches:\n($result.stdout)($result.stderr)"}
  }
}

def main [
  --destination: path
  --strict # Also download the pinned archive and compare every source file.
] {
  let root = ($env.FILE_PWD | path dirname)
  let pin = (open ($root | path join upstream zed.lock.toml))
  let target = ($destination | default ($root | path join upstream zed))
  checked nu ($root | path join scripts bootstrap-controls.nu) --destination ($target | path dirname | path join gpui-component)
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
    verify-series $target $patches
    if $strict {
      verify-pristine $target $pin $patches
      print $"Pinned Zed source matches the archive and patches at ($target)"
      return
    }
    print $"Pinned Zed source and patches verified at ($target)"
    return
  }
  mkdir ($target | path dirname)
  let stage = (mktemp -d | str trim)
  try {
    let source = (fetch-pinned $pin $stage)
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
