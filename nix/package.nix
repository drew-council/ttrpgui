{
  lib,
  stdenvNoCC,
  bun,
  nodejs,
  electron,
  makeWrapper,
  makeDesktopItem,
  copyDesktopItems,
  yt-dlp,
  ffmpeg,
}:
let
  root = ../.;
  pkgJson = lib.importJSON (root + "/package.json");

  # Every dependency in bun.lock, fetched once per lock change: `dev` builds the client, `prod` runs the app.
  # Only the dependency fields of package.json are inputs, so other edits do not refetch.
  # After changing dependencies, `nix build` fails with a hash mismatch: put its `got:` hash here.
  nodeModules = stdenvNoCC.mkDerivation {
    pname = "ttrpgui-node-modules";
    version = "0";
    src = lib.fileset.toSource {
      inherit root;
      fileset = root + "/bun.lock";
    };
    nativeBuildInputs = [ bun ];
    packageJson = builtins.toJSON {
      inherit (pkgJson) name dependencies devDependencies;
    };
    passAsFile = [ "packageJson" ];
    dontConfigure = true;
    dontInstall = true;
    dontFixup = true;
    buildPhase = ''
      runHook preBuild
      export HOME=$TMPDIR
      cp $packageJsonPath package.json
      # Scripts stay off: Electron comes from nixpkgs, not its npm postinstall download.
      bun install --frozen-lockfile --ignore-scripts --no-progress
      mkdir -p $out/dev $out/prod
      mv node_modules $out/dev
      bun install --frozen-lockfile --ignore-scripts --no-progress --production
      mv node_modules $out/prod
      runHook postBuild
    '';
    outputHashMode = "recursive";
    outputHash =
      {
        x86_64-linux = "sha256-maPagB8VT2vvZp6lVIyCK112DLlKRCbGWVBHEjItv5g=";
      }
      .${stdenvNoCC.hostPlatform.system} or lib.fakeHash;
  };

  app = "${placeholder "out"}/share/ttrpgui";
in
stdenvNoCC.mkDerivation {
  pname = "ttrpgui";
  version = "0";
  src = lib.fileset.toSource {
    inherit root;
    fileset = lib.fileset.unions [
      (root + "/package.json")
      (root + "/tsconfig.json")
      (root + "/vite.config.ts")
      (lib.fileset.fileFilter (file: !lib.hasSuffix ".test.ts" file.name) (root + "/src"))
    ];
  };
  nativeBuildInputs = [
    nodejs
    makeWrapper
    copyDesktopItems
  ];

  buildPhase = ''
    runHook preBuild
    ln -s ${nodeModules}/dev/node_modules
    node node_modules/vite/bin/vite.js build
    runHook postBuild
  '';

  # Electron runs the .ts sources directly, so the app is the server sources, the built client, and runtime deps.
  installPhase = ''
    runHook preInstall
    mkdir -p ${app}/src
    cp -r package.json dist ${app}
    cp -r src/server src/shared src/electron.ts src/start.ts src/preload.cjs src/cli.ts ${app}/src
    cp -r ${nodeModules}/prod/node_modules ${app}
    install -Dm444 ${./ttrpgui.svg} $out/share/icons/hicolor/scalable/apps/ttrpgui.svg
    makeWrapper ${lib.getExe electron} $out/bin/ttrpgui \
      --add-flags ${app} \
      --add-flags "\''${NIXOS_OZONE_WL:+\''${WAYLAND_DISPLAY:+--ozone-platform-hint=auto --enable-features=WaylandWindowDecorations --enable-wayland-ime=true}}" \
      --prefix PATH : ${
        lib.makeBinPath [
          yt-dlp
          ffmpeg
        ]
      }
    makeWrapper ${lib.getExe electron} $out/bin/ttrpgui-cli \
      --set ELECTRON_RUN_AS_NODE 1 \
      --add-flags ${app}/src/cli.ts \
      --prefix PATH : ${
        lib.makeBinPath [
          yt-dlp
          ffmpeg
        ]
      }
    runHook postInstall
  '';

  desktopItems = [
    (makeDesktopItem {
      name = "ttrpgui";
      desktopName = "ttrpgui";
      comment = "Plan and run tabletop RPGs";
      exec = "ttrpgui";
      icon = "ttrpgui";
      startupWMClass = "ttrpgui";
      categories = [
        "Game"
        "RolePlaying"
      ];
    })
  ];

  passthru = { inherit nodeModules; };

  meta = {
    description = "Keyboard-driven app for planning and running tabletop RPGs";
    homepage = "https://github.com/drew-council/ttrpgui";
    license = with lib.licenses; [
      mit
      asl20
    ];
    mainProgram = "ttrpgui";
    inherit (electron.meta) platforms;
  };
}
