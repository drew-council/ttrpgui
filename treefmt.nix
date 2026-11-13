{
  ...
}:
{
  projectRootFile = "flake.nix";
  programs = {
    nixfmt = {
      enable = true;
    };
    jsonfmt = {
      enable = true;
      excludes = [ "tsconfig.json" ];
    };
    shellcheck = {
      enable = true;
    };
    yamlfmt = {
      enable = true;
    };
    toml-sort = {
      enable = true;
    };
    dos2unix = {
      enable = true;
    };
    keep-sorted = {
      enable = true;
    };
    topiary-nushell = {
      enable = true;
    };
    biome = {
      enable = true;
    };
  };

  settings = {
    excludes = [ ];
    formatter = { };
  };
}
