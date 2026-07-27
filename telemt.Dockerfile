FROM debian:bookworm-slim

RUN apt-get update && \
    apt-get install -y curl wget ca-certificates && \
    rm -rf /var/lib/apt/lists/*

RUN ARCH=$(uname -m) && \
    wget -qO- "https://github.com/telemt/telemt/releases/latest/download/telemt-${ARCH}-linux-gnu.tar.gz" | tar -xz -C /usr/local/bin/ && \
    chmod +x /usr/local/bin/telemt

RUN useradd -r -s /bin/false telemt && \
    mkdir -p /etc/telemt /opt/telemt && \
    chown -R telemt:telemt /etc/telemt /opt/telemt

WORKDIR /opt/telemt

USER telemt

ENV RUST_LOG=info

CMD ["/usr/local/bin/telemt", "/etc/telemt/config.toml"]
