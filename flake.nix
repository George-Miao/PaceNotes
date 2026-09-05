{
  description = "PaceNotes";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
    }:
    flake-utils.lib.eachSystem
      [
        "aarch64-darwin"
        "aarch64-linux"
        "x86_64-linux"
      ]
      (
        system:
        let
          pkgs = import nixpkgs { inherit system; };
          inherit (pkgs) lib;
          pnpm = pkgs.pnpm_11;
          app = pkgs.stdenvNoCC.mkDerivation (finalAttrs: {
            pname = "pacenotes";
            version = "0.1.0";
            src = lib.cleanSourceWith {
              src = ./app;
              filter =
                path: type:
                let
                  name = baseNameOf path;
                in
                type != "directory"
                || !(builtins.elem name [
                  "node_modules"
                  ".output"
                  "coverage"
                  "test-results"
                  "playwright-report"
                ]);
            };
            nativeBuildInputs = [
              pkgs.nodejs_24
              pkgs.pnpmConfigHook
              pnpm
            ];
            pnpmDeps = pkgs.fetchPnpmDeps {
              inherit (finalAttrs) pname version src;
              inherit pnpm;
              fetcherVersion = 4;
              hash = "sha256-lrVmcUVOa9QPwO3f2q1/raP4HiS9a53KdfiS1rihV+E=";
            };
            buildPhase = ''
              runHook preBuild
              pnpm build
              runHook postBuild
            '';
            installPhase = ''
              runHook preInstall
              mkdir -p $out/lib/pacenotes
              cp -R .output drizzle $out/lib/pacenotes/
              runHook postInstall
            '';
            doCheck = true;
            checkPhase = ''
              runHook preCheck
              pnpm lint
              pnpm test
              runHook postCheck
            '';
          });
          dockerImage = pkgs.dockerTools.buildLayeredImage {
            name = "pacenotes";
            tag = "0.1.0";
            contents = pkgs.buildEnv {
              name = "pacenotes-root";
              paths = [
                pkgs.nodejs_24
                pkgs.cacert
                app
              ];
              pathsToLink = [
                "/bin"
                "/lib/pacenotes"
              ];
            };
            config = {
              WorkingDir = "/lib/pacenotes";
              Env = [
                "NODE_ENV=production"
                "PORT=3000"
              ];
              Cmd = [
                "/bin/node"
                ".output/server/index.mjs"
              ];
              ExposedPorts = {
                "3000/tcp" = { };
              };
            };
          };
        in
        {
          devShells.default = pkgs.mkShell {
            packages = [
              pkgs.nodejs_24
              pnpm
              pkgs.postgresql_18
              pkgs.docker-compose
            ];
            shellHook = ''
              export PATH="$PWD/app/node_modules/.bin:$PATH"
            '';
          };
          packages = {
            default = app;
          }
          // lib.optionalAttrs pkgs.stdenv.hostPlatform.isLinux { docker = dockerImage; };
          checks.default = app;
          formatter = pkgs.nixfmt-tree;
        }
      );
}
