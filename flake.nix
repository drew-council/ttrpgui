{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    topiary-nushell = {
      url = "github:drew-council/topiary-nushell-nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    treefmt-nix.url = "github:numtide/treefmt-nix";
    fenix = {
      url = "github:nix-community/fenix";
      inputs = {
        nixpkgs = {
          follows = "nixpkgs";
        };
      };
    };
  };
  outputs =
    inputs@{
      self,
      nixpkgs,
      flake-utils,
      topiary-nushell,
      treefmt-nix,
      ...
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs {
          inherit system;
        };
        rustToolchain = with inputs.fenix.packages.${system}; combine [ stable.toolchain ];
        runtimeLibraries = with pkgs; [
          libxcb
          libxkbcommon
          wayland
          libglvnd
          vulkan-loader
          fontconfig
          freetype
          openssl
          zlib
          zstd
          bzip2
          alsa-lib
          libgit2
          libxml2
          stdenv.cc.cc.lib
        ];
        treefmtEval = treefmt-nix.lib.evalModule pkgs {
          imports = [
            topiary-nushell.treefmtModules.default
            ./treefmt.nix
          ];
        };
      in
      {
        legacyPackages = pkgs;
        packages.runtime = pkgs.buildEnv {
          name = "ttrpgui-runtime";
          paths = runtimeLibraries;
          pathsToLink = [ "/lib" ];
          ignoreCollisions = true;
        };
        devShells.default = pkgs.mkShell {
          inputsFrom = [ pkgs.zed-editor ];
          packages = with pkgs; [
            (aspellWithDicts (ps: with ps; [ en ]))
            nushell
            rustToolchain
            curl
            git
            patch
            pkg-config
            cmake
            protobuf
            clang
            lld
            neovim
          ];
          LIBCLANG_PATH = "${pkgs.libclang.lib}/lib";
          PROTOC = "${pkgs.protobuf}/bin/protoc";
          LD_LIBRARY_PATH =
            pkgs.lib.makeLibraryPath (
              with pkgs;
              [
                libxcb
                libxkbcommon
                wayland
                libglvnd
                vulkan-loader
                fontconfig
                freetype
                openssl
                zlib
                zstd
                bzip2
                alsa-lib
                libgit2
                libxml2
                stdenv.cc.cc.lib
              ]
            )
            + ":/run/opengl-driver/lib";
        };

        formatter = treefmtEval.config.build.wrapper;
        checks.formatting = treefmtEval.config.build.check self;
      }
    );
}
