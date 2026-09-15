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
              hash = "sha256-l8DcZVPIu/S7NHeP6Lp9TswPA6OMeLyLMxoA+QPZfzg=";
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
              ${lib.getExe pkgs.biome} check .
              pnpm test
              runHook postCheck
            '';
          });
          dockerImage = pkgs.dockerTools.buildLayeredImage {
            name = "pacenotes";
            tag = "nix";
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
          motisBuild = pkgs.writeShellApplication {
            name = "build-patched-motis";
            runtimeInputs = with pkgs; [
              bzip2
              cacert
              cmake
              coreutils
              curl
              gcc13
              git
              ninja
              nodejs_24
              openssh
              pnpm
              pkg-config
              python3
              unzip
            ];
            text = ''
              cache_root="''${XDG_CACHE_HOME:-$HOME/.cache}/pacenotes/motis-v2.11.3"
              source_dir="$cache_root/source"
              build_dir="$cache_root/build"
              patch_file="''${MOTIS_PATCH:-$PWD/patch/osr-32-way-nodes.patch}"
              motis_revision="b228a4519d196d9dd01b5ce80be46e642abc953e"
              osr_revision="a7b2ec2728544304ef1d8397b3042abc8d10f7e7"

              mkdir -p "$cache_root"
              if [[ ! -d "$source_dir/.git" ]]; then
                git clone --branch v2.11.3 --depth 1 \
                  https://github.com/motis-project/motis.git "$source_dir"
              fi

              if [[ "$(git -C "$source_dir" rev-parse HEAD)" != "$motis_revision" ]]; then
                echo "MOTIS source is not at the required revision: $motis_revision" >&2
                exit 1
              fi

              CC=gcc CXX=g++ cmake --compile-no-warning-as-error \
                -S "$source_dir" -B "$build_dir" -GNinja -DCMAKE_BUILD_TYPE=Release

              osr_dir="$source_dir/deps/osr"
              if [[ "$(git -C "$osr_dir" rev-parse HEAD)" != "$osr_revision" ]]; then
                echo "OSR source is not at the required revision: $osr_revision" >&2
                exit 1
              fi

              if git -C "$osr_dir" apply --check "$patch_file"; then
                git -C "$osr_dir" apply "$patch_file"
              elif ! git -C "$osr_dir" apply --reverse --check "$patch_file"; then
                echo "OSR patch does not apply cleanly" >&2
                exit 1
              fi

              CC=gcc CXX=g++ cmake --compile-no-warning-as-error \
                -S "$source_dir" -B "$build_dir" -GNinja -DCMAKE_BUILD_TYPE=Release
              cmake --build "$build_dir" --target motis osr-test --parallel 16
              pnpm --dir "$source_dir/ui" install --frozen-lockfile
              pnpm --dir "$source_dir/ui" run update-api
              pnpm --dir "$source_dir/ui" build
              echo "$build_dir/motis"
            '';
          };
          motisRun = pkgs.writeShellApplication {
            name = "motis";
            runtimeInputs = [ pkgs.coreutils ];
            text = ''
              binary="''${XDG_CACHE_HOME:-$HOME/.cache}/pacenotes/motis-v2.11.3/build/motis"
              if [[ ! -x "$binary" ]]; then
                echo "Run nix run .#motis-build first" >&2
                exit 1
              fi
              exec "$binary" "$@"
            '';
          };
        in
        {
          apps = {
            motis-build = flake-utils.lib.mkApp { drv = motisBuild; };
            motis = flake-utils.lib.mkApp { drv = motisRun; };
          };
          devShells.default = pkgs.mkShell {
            packages = [
              pkgs.infisical
              pkgs.nodejs_24
              pnpm
              pkgs.postgresql_18
              pkgs.docker-compose
            ];
            PLAYWRIGHT_BROWSERS_PATH = "${pkgs.playwright-driver.browsers}";
            PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1";
            shellHook = ''
              export PATH="$PWD/app/node_modules/.bin:$PATH"
            '';
          };
          packages = {
            default = app;
            motis-build = motisBuild;
            motis = motisRun;
          }
          // lib.optionalAttrs pkgs.stdenv.hostPlatform.isLinux { docker = dockerImage; };
          checks.default = app;
          formatter = pkgs.nixfmt-tree;
        }
      );
}
