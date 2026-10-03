{
  binary,
  runtime,
  nixpkgsPath,
  sourceArchive,
}:
let
  pkgs = import (builtins.toPath nixpkgsPath) { };
  executable = builtins.path {
    path = builtins.toPath binary;
    name = "ttrpgui-unwrapped";
  };
  source = builtins.path {
    path = builtins.toPath sourceArchive;
    name = "ttrpgui-source.tar.gz";
  };
in
pkgs.runCommand "ttrpgui-0.1.0"
  {
    nativeBuildInputs = [
      pkgs.makeWrapper
      pkgs.binutils
    ];
    meta = {
      description = "Native campaign workspace with Zed editor and Vim libraries";
      license = pkgs.lib.licenses.gpl3Plus;
      platforms = pkgs.lib.platforms.linux;
      mainProgram = "ttrpgui";
    };
  }
  ''
    mkdir -p $out/libexec $out/bin $out/share/doc/ttrpgui $out/share/applications
    cp ${executable} $out/libexec/ttrpgui
    chmod +w $out/libexec/ttrpgui
    strip --strip-all $out/libexec/ttrpgui
    makeWrapper $out/libexec/ttrpgui $out/bin/ttrpgui \
      --prefix LD_LIBRARY_PATH : ${runtime}/lib:/run/opengl-driver/lib
    cp ${../LICENSE} $out/share/doc/ttrpgui/LICENSE
    cp ${../THIRD_PARTY_NOTICES.md} $out/share/doc/ttrpgui/THIRD_PARTY_NOTICES.md
    cp ${source} $out/share/doc/ttrpgui/source.tar.gz
    cat > $out/share/applications/io.ttrpgui.desktop <<EOF
    [Desktop Entry]
    Type=Application
    Name=ttrpgui
    Comment=Campaign notes and encounters
    Exec=$out/bin/ttrpgui
    Terminal=false
    Categories=Game;RolePlaying;
    EOF
  ''
