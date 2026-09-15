# syntax=docker/dockerfile:1.7
FROM ghcr.io/motis-project/docker-cpp-build@sha256:b2f2a0256c2c67c63e011a4f778e236a0f86cded0c6db99a3e84f704ebab250f AS builder

ARG MOTIS_REVISION=b228a4519d196d9dd01b5ce80be46e642abc953e
ARG OSR_REVISION=a7b2ec2728544304ef1d8397b3042abc8d10f7e7

WORKDIR /build
RUN git clone --branch v2.11.3 --depth 1 https://github.com/motis-project/motis.git source && \
    test "$(git -C source rev-parse HEAD)" = "$MOTIS_REVISION"

WORKDIR /build/source
RUN --mount=type=cache,target=/deps \
    ln -s /deps deps && \
    cmake -G Ninja -S . -B build --preset=linux-amd64-release
COPY patch/osr-32-way-nodes.patch /tmp/osr-32-way-nodes.patch
RUN --mount=type=cache,target=/deps \
    test "$(git -C deps/osr rev-parse HEAD)" = "$OSR_REVISION" && \
    git -C deps/osr apply --check /tmp/osr-32-way-nodes.patch && \
    git -C deps/osr apply /tmp/osr-32-way-nodes.patch && \
    cmake -G Ninja -S . -B build --preset=linux-amd64-release && \
    cmake --build build --target motis osr-test --parallel 16 && \
    build/deps/osr/osr-test

RUN apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install --yes --no-install-recommends python3 unzip && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /import
COPY motis/config.yml ./config.yml
COPY motis/fetch-inputs.sh /usr/local/bin/fetch-motis-inputs
COPY motis/enrich_rail_shapes.py /usr/local/lib/motis/enrich_rail_shapes.py
COPY motis/test_enrich_rail_shapes.py /usr/local/lib/motis/test_enrich_rail_shapes.py
RUN chmod 0755 /usr/local/bin/fetch-motis-inputs && \
    python3 -m unittest discover -s /usr/local/lib/motis -p 'test_*.py' && \
    fetch-motis-inputs && \
    cp jp_japan-rail.source.gtfs.zip jp_japan-rail.gtfs.zip && \
    python3 /usr/local/lib/motis/enrich_rail_shapes.py \
      jp_japan-rail.gtfs.zip N02-25_GML.zip && \
    sha256sum jp_japan-rail.gtfs.zip >> input-sha256.txt && \
    /build/source/build/motis import && \
    cp input-sha256.txt data/input-sha256.txt

FROM alpine:3.20@sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc
RUN apk add --no-cache ca-certificates curl libgcc libstdc++ && \
    addgroup -S motis && \
    adduser -S motis -G motis && \
    mkdir -p /data /licenses && \
    chown motis:motis /data
COPY --from=builder /build/source/build/motis /motis
COPY --from=builder --chown=motis:motis /import/data/ /data/
COPY --from=builder /build/source/LICENSE /licenses/MOTIS.txt
RUN printf '%s\n' \
      'This image uses National Land Numerical Information Railway Data N02-25 from MLIT, Japan.' \
      'Source: https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N02-2025.html' \
      'PaceNotes modifies the source geometry to create GTFS shape records.' \
      'Terms: https://nlftp.mlit.go.jp/ksj/other/agreement_01.html' \
      > /licenses/MLIT-N02.txt
COPY docs/routes.md /licenses/ROUTES.md

EXPOSE 8080
USER motis
HEALTHCHECK --interval=10s --timeout=5s --retries=12 \
  CMD ["/usr/bin/curl", "--fail", "--silent", "http://127.0.0.1:8080/api/v1/health"]
CMD ["/motis", "server", "/data"]
